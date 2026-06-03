import { NextResponse, after } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';

export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { error: resetErr } = await sb
    .from('posts').update({ status: 'queued', validation: null }).eq('id', id);
  if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 400 });

  try {
    await generatePost(id);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }

  // schedule cover image via after() so it survives response return
  after(async () => { await runCoverForPost(id); });

  return NextResponse.json({ ok: true });
}
