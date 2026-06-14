import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { runCoverForPost } from '@/lib/pipeline/cover-image';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  // runCoverForPost runs as the service role (bypasses RLS), so verify the
  // caller owns this post first — otherwise any logged-in user could burn
  // image-generation credits on, and overwrite the cover of, another tenant's
  // post. This SELECT is RLS-scoped to the owner.
  const { data: owned } = await sb.from('posts').select('id').eq('id', id).maybeSingle();
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 });

  await runCoverForPost(id);
  return NextResponse.json({ ok: true });
}
