/**
 * Minimal Supabase-backed rate limiter — a sliding window over the `rate_hits`
 * table. Serverless-friendly: no in-memory state, no external service.
 *
 * Keyed by a caller-supplied bucket string (e.g. `gen:<userId>`). It counts
 * hits in the trailing window; if under the limit it records a hit and allows.
 *
 * Fails OPEN: any error — including the table not existing yet — allows the
 * request. So a limiter glitch can never lock an owner out of their own tool,
 * and the code can ship before migration 0012 is applied.
 *
 * Caps are intentionally generous (these gate cost-bearing AI endpoints to stop
 * scripted abuse, not to throttle normal use). Tune the LIMITS below freely.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase/admin';
import { captureServer } from './analytics/capture-server';
import { parseRateBucket } from './analytics/events';

export const LIMITS = {
  generate: { limit: 20, windowSec: 3600 }, // full article pipeline (LLM-heavy)
  image: { limit: 40, windowSec: 3600 },    // Replicate cover / inline images
  // Author's own uploads. Kept off the `image` budget on purpose: an upload
  // costs storage, not Replicate credits, so letting it eat the generation
  // allowance would price a free action against a paid one.
  upload: { limit: 80, windowSec: 3600 },
  llm: { limit: 60, windowSec: 3600 },      // lighter single LLM calls
  crawl: { limit: 10, windowSec: 3600 },    // outbound site crawl + profiler
  // Beta coupon redemption. Deliberately the tightest bucket here, and not
  // because redeeming is expensive — it's a handful of queries. A redeem
  // endpoint is a guessing oracle: it takes a string and says whether that
  // string is worth money. Someone with a legitimate code needs one or two
  // attempts, so 10/hour costs a real customer nothing and makes enumerating
  // the code space pointless.
  redeem: { limit: 10, windowSec: 3600 },
  // Customer→owner feedback. Every submission emails the owner, so this is the
  // one customer-facing write that lands in a human's inbox — generous enough
  // that nobody with three real things to say is ever turned away, tight enough
  // that a script can't bury the inbox it exists to fill.
  feedback: { limit: 12, windowSec: 3600 },
  // MCP calls from a customer's agent. Generous because an agent doing a first
  // import of a year's archive legitimately makes hundreds of calls in a row
  // (pull, write, record, repeat) — and none of them costs an LLM token on
  // grove's side. It exists to stop a runaway loop, not to pace a real sync.
  mcp: { limit: 600, windowSec: 3600 },
} as const;

export type RateResult = { ok: boolean; retryAfterSec?: number };

export async function rateLimit(
  bucket: string,
  opts: { limit: number; windowSec: number },
): Promise<RateResult> {
  const since = new Date(Date.now() - opts.windowSec * 1000).toISOString();
  try {
    const sb = supabaseAdmin();
    const { count, error } = await sb
      .from('rate_hits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket', bucket)
      .gte('created_at', since);
    if (error) return { ok: true }; // fail open (e.g. table not yet migrated)
    if ((count ?? 0) >= opts.limit) return { ok: false, retryAfterSec: opts.windowSec };
    await sb.from('rate_hits').insert({ bucket });
    return { ok: true };
  } catch {
    return { ok: true }; // fail open
  }
}

/**
 * Convenience for route handlers: returns a 429 NextResponse when over the
 * limit, or null when the call is allowed.
 *
 *   const limited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
 *   if (limited) return limited;
 */
export async function enforceRateLimit(
  bucket: string,
  opts: { limit: number; windowSec: number },
): Promise<NextResponse | null> {
  const r = await rateLimit(bucket, opts);
  if (r.ok) return null;
  // Captured at the choke point rather than at each of the nineteen call
  // sites: this is the moment a customer wanted to do something and the
  // platform said no, and instrumenting it here means a route added later
  // reports its friction without anyone remembering to wire it up.
  const { bucket: kind, userId } = parseRateBucket(bucket);
  await captureServer(userId, 'rate_limited', { bucket: kind });
  return NextResponse.json(
    { error: 'Too many requests — slow down and try again shortly.' },
    { status: 429, headers: { 'retry-after': String(r.retryAfterSec ?? opts.windowSec) } },
  );
}
