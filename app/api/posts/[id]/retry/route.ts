import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generatePost } from '@/lib/pipeline/generate';

// Vercel: allow up to 5 min for generation (research + writer + validate).
export const maxDuration = 300;

/**
 * Reset a failed (or any) post back to 'queued', clear validation, and
 * immediately run the pipeline. User gets fresh draft without waiting on cron.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  // RLS ensures the user can only reset their own posts
  const { error: resetErr } = await sb
    .from('posts').update({ status: 'queued', validation: null }).eq('id', id);
  if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 400 });

  try {
    await generatePost(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
