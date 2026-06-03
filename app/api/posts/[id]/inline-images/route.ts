import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { runInlineImagesForPost } from '@/lib/pipeline/inline-images';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  await runInlineImagesForPost(id);
  return NextResponse.json({ ok: true });
}
