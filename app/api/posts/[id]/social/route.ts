import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { runSocialAdapter } from '@/lib/pipeline/writer';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`llm:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  const { id } = await ctx.params;
  const { data: post } = await sb.from('posts').select('*, domains(site_profile)').eq('id', id).single();
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!post.body_md || !post.title) return NextResponse.json({ error: 'article not ready' }, { status: 400 });

  const profile = (post as any).domains?.site_profile;
  if (!profile?.business?.name) return NextResponse.json({ error: 'site profile missing — wait a moment' }, { status: 400 });

  try {
    const social = await runSocialAdapter({ title: post.title, body_md: post.body_md }, profile);
    const admin = supabaseAdmin();
    await admin.from('posts').update({ social }).eq('id', id);
    return NextResponse.json({ ok: true, social });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
