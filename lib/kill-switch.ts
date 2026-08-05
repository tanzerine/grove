/**
 * Global generation kill switch — one lever that halts all cost-bearing work.
 *
 * The scenario this exists for: spend is running away, or the model provider is
 * returning garbage, and it is 3am. Every other guard in the codebase is
 * per-account (lib/billing entitlement, lib/quota allowance, lib/ratelimit).
 * None of them can answer "stop everything, now."
 *
 * TWO LEVERS, OPPOSITE FAILURE MODES.
 *
 *   platform_flags.generation_paused (migration 0033) — the primary. A row, so
 *     flipping it takes effect on the very next request with no deploy. This is
 *     the one you reach for.
 *
 *   GROVE_GENERATION_PAUSED=1 — the backstop. Needs a redeploy on Vercel (env
 *     changes only apply to new deployments), which is precisely why it cannot
 *     be the primary. It earns its place by being the lever that still works
 *     when Supabase is the thing that is broken.
 *
 * FAILS OPEN on a read error, deliberately, and this is the one judgement call
 * here worth arguing with. A kill switch that fails closed turns a transient
 * Supabase blip into a silent platform-wide outage — and generation cannot run
 * without the database anyway (every pipeline step writes to posts.generation_log),
 * so a failed read would halt the work a moment later regardless. Failing open
 * costs nothing real; failing closed invents an outage. The env lever is the
 * answer when the database itself is untrustworthy.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase/admin';

export const GENERATION_PAUSED = 'generation_paused';

export type FlagRow = {
  key?: string | null;
  enabled?: boolean | null;
  note?: string | null;
};

export type PauseState = {
  paused: boolean;
  /** Which lever did it: the env backstop, the database row, or neither. */
  source: 'env' | 'db' | null;
  /** Operator note from the flag row, surfaced so the 503 explains itself. */
  note: string | null;
};

export const NOT_PAUSED: PauseState = { paused: false, source: null, note: null };

// ── pure decision logic ────────────────────────────────────────────────────

/**
 * Is the env backstop engaged?
 *
 * Accepts the handful of spellings someone types under pressure. Anything
 * unrecognised — including the empty string Vercel hands back for an env var
 * that exists but is blank — reads as "not paused", because a typo must never
 * be able to halt the platform by accident.
 */
export function envPaused(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Resolve both levers into one verdict. Env is checked FIRST so the backstop
 * still speaks when the database row can't be read (the caller passes null).
 */
export function pauseStateFrom(
  row: FlagRow | null | undefined,
  envRaw: string | undefined | null,
): PauseState {
  if (envPaused(envRaw)) {
    return { paused: true, source: 'env', note: row?.note ?? null };
  }
  if (row?.enabled === true) {
    return { paused: true, source: 'db', note: row.note ?? null };
  }
  return NOT_PAUSED;
}

/** What a customer sees. The operator note is appended when there is one. */
export function pausedMessage(state: PauseState): string {
  const base = 'Article generation is paused platform-wide while we sort something out. Nothing you have already published is affected, and queued work resumes automatically.';
  const note = state.note?.trim();
  return note ? `${base} (${note})` : base;
}

// ── stored state ───────────────────────────────────────────────────────────

/**
 * Current pause state. One tiny primary-key lookup; safe to call per request
 * and, in the drain, per post — which is the point, since a tick runs for up to
 * five minutes and a switch you have to wait out is not a switch.
 */
export async function generationPaused(): Promise<PauseState> {
  const envRaw = process.env.GROVE_GENERATION_PAUSED;
  // Short-circuit before any IO: the backstop must not depend on the database.
  if (envPaused(envRaw)) return { paused: true, source: 'env', note: null };

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from('platform_flags')
      .select('key, enabled, note')
      .eq('key', GENERATION_PAUSED)
      .maybeSingle();
    // A missing table (pre-migration) or an unreachable database reads as "not
    // paused" — see the fails-open note at the top of this file.
    if (error) return NOT_PAUSED;
    return pauseStateFrom(data as FlagRow | null, envRaw);
  } catch {
    return NOT_PAUSED;
  }
}

/**
 * Route-handler convenience, mirroring enforceRateLimit / enforceQuota /
 * enforceEntitlement: returns a 503 when generation is halted, or null when the
 * caller may proceed.
 *
 *   const halted = await enforceNotPaused();
 *   if (halted) return halted;
 *
 * 503 rather than 402/429 because this is neither the customer's fault nor
 * their allowance — it is us, temporarily. `retry-after` keeps well-behaved
 * clients from hammering the switch.
 */
export async function enforceNotPaused(): Promise<NextResponse | null> {
  const state = await generationPaused();
  if (!state.paused) return null;
  return NextResponse.json(
    { error: 'generation_paused', message: pausedMessage(state) },
    { status: 503, headers: { 'retry-after': '900' } },
  );
}
