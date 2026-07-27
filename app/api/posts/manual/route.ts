import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { ensurePostSlug } from '@/lib/post-slug';
import { captureServer } from '@/lib/analytics/capture-server';

// Create a blank, human-written draft. Unlike POST /api/posts this does NOT
// run the AI pipeline or the manager evaluation — it just lands an editable
// post in `review` so the author opens straight into the editor and writes.
const body = z.object({
  domain_id: z.string().uuid(),
  title: z.string().max(160).optional(),
  body_md: z.string().optional(),
  // Set when the author schedules straight from the Write page — the draft is
  // created already `scheduled`, and the cron publishes it when its time comes.
  scheduled_at: z.string().datetime().optional(),
});

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb
    .from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const title = parsed.data.title?.trim() || 'Untitled draft';
  const scheduledAt = parsed.data.scheduled_at ?? null;

  const { data, error } = await sb.from('posts').insert({
    domain_id: parsed.data.domain_id,
    // 'review' = editable + reviewable, same as a finished AI draft. A publish
    // time the author picked is an explicit decision, so honour it right away.
    status: scheduledAt ? 'scheduled' : 'review',
    topic: title,
    title,
    body_md: parsed.data.body_md ?? '',
    scheduled_at: scheduledAt,
  }).select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Captured on the route rather than in the Write page because two different
  // components post here (StartDraft and RichEditor's save-as-new).
  await captureServer(user.id, 'manual_draft_created', {
    domain_id: parsed.data.domain_id,
    scheduled: !!scheduledAt,
  });
  // A scheduled post will be published by the cron, so it needs its public URL
  // slug now — nothing else assigns one to a hand-written draft.
  if (scheduledAt) await ensurePostSlug(sb, data.id);
  return NextResponse.json({ id: data.id });
}
