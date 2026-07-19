import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { approveAndPublish } from '@/lib/pipeline/approve';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const result = await approveAndPublish(sb, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, social_result: result.social_result });
}
