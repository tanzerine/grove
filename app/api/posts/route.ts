import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { canGenerateForUser } from '@/lib/billing';

export const maxDuration = 300;

const body = z.object({ domain_id: z.string().uuid(), topic: z.string().min(3) });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
  if (limited) return limited;

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  if (!(await canGenerateForUser(user.id, sb))) {
    return NextResponse.json(
      { error: 'payment_required', message: 'An active subscription is required to generate content.' },
      { status: 402 },
    );
  }

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await sb.from('posts').insert({
    domain_id: parsed.data.domain_id, status: 'queued', topic: parsed.data.topic,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  try {
    await generatePost(data.id);
  } catch (e: any) {
    const admin = supabaseAdmin();
    await admin.from('posts').update({
      status: 'failed', validation: { error: String(e?.message ?? e) },
    }).eq('id', data.id);
    return NextResponse.json({ id: data.id, error: 'generation failed' }, { status: 500 });
  }

  // Cover image runs AFTER the response. Vercel keeps the function alive
  // up to maxDuration to complete `after()` callbacks — unlike a plain
  // fire-and-forget Promise which dies when the function terminates.
  after(async () => { await runCoverForPost(data.id); });

  return NextResponse.json({ id: data.id });
}
