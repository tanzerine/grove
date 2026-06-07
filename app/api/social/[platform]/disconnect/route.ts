import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteConnection } from '@/lib/social/oauth';
import { PLATFORMS, type Platform } from '@/lib/social/providers';

export async function POST(_req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  if (!PLATFORMS.includes(platform as Platform)) return NextResponse.json({ error: 'unknown platform' }, { status: 400 });

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: domain } = await sb
    .from('domains').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'no domain' }, { status: 400 });

  await deleteConnection(domain.id, platform as Platform);
  return NextResponse.json({ ok: true });
}
