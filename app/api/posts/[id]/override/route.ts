/**
 * POST /api/posts/[id]/override
 *
 * Owner overrides the manager's rewrite/reject and pushes the post into
 * 'review' so they can ship it manually.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS enforces ownership on update
  const { error } = await sb
    .from('posts')
    .update({ status: 'review' })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
