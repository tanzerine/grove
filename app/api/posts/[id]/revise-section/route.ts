import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { reviseSection } from '@/lib/pipeline/revise';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const maxDuration = 60;

const body = z.object({
  selected: z.string().min(1).max(5000),
  instruction: z.string().min(1).max(1000),
  context: z.string().max(20000).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`llm:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { id } = await ctx.params;
  // RLS scopes this to the owner's post.
  const { data: post } = await sb.from('posts').select('id, domains(site_profile)').eq('id', id).single();
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const profile = (post as any).domains?.site_profile ?? null;
  try {
    const revised = await reviseSection({ ...parsed.data, profile });
    if (!revised) return NextResponse.json({ ok: false, error: 'empty result' }, { status: 502 });
    return NextResponse.json({ ok: true, revised });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
