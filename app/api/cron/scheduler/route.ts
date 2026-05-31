/**
 * Hourly cron — runs three responsibilities:
 *   1. publish any 'scheduled' posts whose time has come
 *   2. for verified domains under quota, enqueue new topics
 *   3. drain the 'queued' bucket by generating drafts
 *
 * Guarded by CRON_SECRET (Vercel sets x-vercel-cron header; we also accept bearer).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';

export const maxDuration = 300;

function isAuthorized(req: Request) {
  const auth = req.headers.get('authorization');
  const vc = req.headers.get('x-vercel-cron');
  return vc === '1' || auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();

  // 1) publish scheduled posts whose time has come
  const now = new Date().toISOString();
  const { data: due } = await sb
    .from('posts').select('id')
    .eq('status', 'scheduled').lte('scheduled_at', now);
  for (const p of due ?? []) {
    await sb.from('posts').update({ status: 'published', published_at: now }).eq('id', p.id);
  }

  // 2) drain queued posts (limit 3 per tick to stay under Vercel 300s)
  const { data: queued } = await sb
    .from('posts').select('id').eq('status', 'queued').limit(3);

  for (const p of queued ?? []) {
    try { await generatePost(p.id); }
    catch (e: any) {
      await sb.from('posts').update({ status: 'failed', validation: { error: String(e?.message ?? e) } }).eq('id', p.id);
    }
  }

  return NextResponse.json({ published: due?.length ?? 0, generated: queued?.length ?? 0 });
}
