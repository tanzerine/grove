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

export const LIMITS = {
  generate: { limit: 20, windowSec: 3600 }, // full article pipeline (LLM-heavy)
  image: { limit: 40, windowSec: 3600 },    // Replicate cover / inline images
  llm: { limit: 60, windowSec: 3600 },      // lighter single LLM calls
  crawl: { limit: 10, windowSec: 3600 },    // outbound site crawl + profiler
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
  return NextResponse.json(
    { error: 'Too many requests — slow down and try again shortly.' },
    { status: 429, headers: { 'retry-after': String(r.retryAfterSec ?? opts.windowSec) } },
  );
}
