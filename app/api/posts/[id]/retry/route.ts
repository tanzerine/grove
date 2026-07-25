import { NextResponse, after } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { canGenerateForUser } from '@/lib/billing';
import { enforceQuota, releaseQuota } from '@/lib/quota';

export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  // A retry re-runs the whole pipeline, so it costs a post like any other
  // generation. (The original attempt's reservation was handed back when it
  // failed, so this isn't double-charging for one article.)
  const over = await enforceQuota(user.id);
  if (over) return over;

  const { id } = await ctx.params;
  // The reset is RLS-scoped, but on a post the caller doesn't own it silently
  // matches 0 rows (no error) — and generatePost below runs as the service role.
  // Select the updated row back so a non-owned id is a hard 404 instead of
  // letting anyone trigger (and overwrite) generation on another tenant's post.
  const { data: reset, error: resetErr } = await sb
    .from('posts').update({ status: 'queued', validation: null }).eq('id', id).select('id');
  if (resetErr) {
    await releaseQuota(user.id);
    return NextResponse.json({ error: resetErr.message }, { status: 400 });
  }
  if (!reset?.length) {
    await releaseQuota(user.id);
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    await generatePost(id);
  } catch (e: any) {
    await releaseQuota(user.id);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }

  // schedule cover image via after() so it survives response return
  after(async () => { await runCoverForPost(id); });

  return NextResponse.json({ ok: true });
}
