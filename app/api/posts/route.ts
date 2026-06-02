import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';

export const maxDuration = 300;

const body = z.object({ domain_id: z.string().uuid(), topic: z.string().min(3) });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // insert via user session so RLS records the ownership
  const { data, error } = await sb.from('posts').insert({
    domain_id: parsed.data.domain_id, status: 'queued', topic: parsed.data.topic,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // kick off generation immediately so the user doesn't wait on the daily cron
  try {
    await generatePost(data.id);
  } catch (e: any) {
    // mark failed but don't error the request — the row exists and user can Retry from UI
    const admin = supabaseAdmin();
    await admin.from('posts').update({
      status: 'failed', validation: { error: String(e?.message ?? e) },
    }).eq('id', data.id);
  }
  return NextResponse.json({ id: data.id });
}
