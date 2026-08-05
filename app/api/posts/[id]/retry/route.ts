import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { enforceEntitlement } from '@/lib/billing';
import { enforceNotPaused } from '@/lib/kill-switch';
import { enforceQuota, releaseQuota } from '@/lib/quota';

export const maxDuration = 300;

/**
 * Two different intents share this endpoint, and they must not be conflated:
 *
 *   resume (default) — a run died part-way; pick up from the step that failed
 *                      and reuse the research/draft already paid for.
 *   fresh            — the customer asked for a NEW article. Nothing is reused,
 *                      even though a finished draft is sitting there.
 *
 * Defaulting to `resume` keeps every existing caller (failed/stuck retries, the
 * cheap "re-run the quality check") on the behaviour they were written for.
 */
const body = z.object({ mode: z.enum(['fresh', 'resume']).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
  if (limited) return limited;

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  // Platform-wide halt, checked before anything is reserved or spent.
  const halted = await enforceNotPaused();
  if (halted) return halted;

  const blocked = await enforceEntitlement(user.id, 'retry', sb);
  if (blocked) return blocked;

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  const fresh = parsed.success && parsed.data.mode === 'fresh';

  const { id } = await ctx.params;
  // Read through RLS first: a post the caller doesn't own is simply invisible,
  // so this is also the ownership gate — generatePost below runs as the service
  // role and would happily overwrite another tenant's article.
  const { data: current, error: readErr } = await sb
    .from('posts').select('id, status').eq('id', id).maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 400 });
  if (!current) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Rewriting a live article can't take it off the blog while it runs, and a
  // failed rewrite can't leave it stranded — it stays published throughout.
  const keepLive = fresh && current.status === 'published';

  // A retry re-runs the whole pipeline, so it costs a post like any other
  // generation. (The original attempt's reservation was handed back when it
  // failed, so this isn't double-charging for one article.)
  const over = await enforceQuota(user.id);
  if (over) return over;

  const { error: resetErr } = await sb
    .from('posts')
    .update(keepLive ? { validation: null } : { status: 'queued', validation: null })
    .eq('id', id);
  if (resetErr) {
    await releaseQuota(user.id);
    return NextResponse.json({ error: resetErr.message }, { status: 400 });
  }

  try {
    await generatePost(id, { fresh, keepLive });
  } catch (e: any) {
    await releaseQuota(user.id);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }

  // schedule cover image via after() so it survives response return
  after(async () => { await runCoverForPost(id); });

  return NextResponse.json({ ok: true, mode: fresh ? 'fresh' : 'resume' });
}
