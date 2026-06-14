import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

// Create a blank, human-written draft. Unlike POST /api/posts this does NOT
// run the AI pipeline or the manager evaluation — it just lands an editable
// post in `review` so the author opens straight into the editor and writes.
const body = z.object({
  domain_id: z.string().uuid(),
  title: z.string().max(160).optional(),
  body_md: z.string().optional(),
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

  const { data, error } = await sb.from('posts').insert({
    domain_id: parsed.data.domain_id,
    status: 'review',          // editable + reviewable, same as a finished AI draft
    topic: title,
    title,
    body_md: parsed.data.body_md ?? '',
  }).select('id').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}
