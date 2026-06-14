import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { runInlineImagesForPost } from '@/lib/pipeline/inline-images';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`img:${user.id}`, LIMITS.image);
  if (limited) return limited;

  const { id } = await ctx.params;
  // runInlineImagesForPost runs as the service role (bypasses RLS); confirm the
  // caller owns this post before spending image-generation credits on it. This
  // SELECT is RLS-scoped to the owner.
  const { data: owned } = await sb.from('posts').select('id').eq('id', id).maybeSingle();
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await runInlineImagesForPost(id);
  return NextResponse.json({ ok: true });
}
