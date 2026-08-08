/**
 * Monthly post quota — the volume each plan promises, actually enforced.
 *
 * `subscriptions.posts_quota` was written by the Stripe webhook on every
 * checkout and read by absolutely nothing, so all three tiers behaved
 * identically: the only ceiling on a $29 Starter account was the shared
 * rate limiter (20 generations/hour ≈ 480/day of full LLM pipeline). Tier
 * pricing was decorative and the margin exposure was open-ended.
 *
 * WHAT COUNTS. Metering happens at the moment AI work is started, not by
 * counting rows afterwards. No column distinguishes an AI-generated post from
 * a hand-written draft — `/api/posts/manual` sets `topic` and lands in `review`
 * exactly like a finished pipeline draft, and pSEO pages carry neither
 * `research` nor a `generation_log` — so any derived count would either bill
 * customers for drafts they typed themselves or let the highest-volume path
 * (pSEO) through free. Reserving at the call site meters exactly the work that
 * costs money, which is also what `posts_used` / `cycle_resets_at` were added
 * for and never wired up.
 *
 * FAILS OPEN, like lib/ratelimit. A subscription we can't confidently price —
 * a Stripe price id missing from the env catalogue, an unrecognised plan — is
 * not enforced, because throttling a paying customer over our own
 * misconfiguration is far worse than briefly over-delivering. The admin
 * overview surfaces the billing mismatch separately.
 *
 * The cycle is the calendar month (UTC), matching `cycle_resets_at`'s default
 * and the monthly strategy/report cadence the whole product runs on. It resets
 * lazily on first use after the boundary — no cron, nothing to fall behind.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase/admin';
import { PLANS, isPlanId, planForPriceId } from './plans';
import { captureServer } from './analytics/capture-server';
import { effectiveBeta } from './beta';

export type QuotaRow = {
  plan?: string | null;
  posts_quota?: number | null;
  posts_used?: number | null;
  cycle_resets_at?: string | null;
  stripe_price_id?: string | null;
  stripe_status?: string | null;
  /** Not metered at all — internal/dogfooding/comped. See migration 0030. */
  comped?: boolean | null;
  /** Free beta grant — metered against its own allowance. See migration 0033. */
  beta_code?: string | null;
  beta_expires_at?: string | null;
  beta_posts_quota?: number | null;
};

export type QuotaState = {
  /** False when this account must not be throttled (see "fails open" above). */
  enforced: boolean;
  limit: number | null;
  used: number;
  /** Infinity when unenforced. */
  remaining: number;
  exhausted: boolean;
  /** When the current cycle rolls over — for the "resets on…" message. */
  resetsAt: string;
};

/**
 * `*`, deliberately, rather than naming the columns.
 *
 * Naming them means a column this file expects but the database hasn't got yet
 * (0030's `comped`, before it is applied) fails the whole query. `data` comes
 * back null, `limitFor(null)` returns "not enforced", and every customer on the
 * platform is silently unmetered — the single worst outcome this module has.
 * A star select just omits what isn't there, so a missing column reads as
 * `undefined` and the guard falls through to today's behaviour.
 *
 * Same reasoning as getActiveDomain, which selects `*` so it stayed safe
 * before the gsc_* columns landed. Subscription rows are tiny; this costs
 * nothing worth measuring.
 */
const SELECT = '*';

// ── pure decision logic ────────────────────────────────────────────────────

/**
 * The monthly limit to enforce, or null when it must not be enforced.
 *
 * Prefers the stored `posts_quota` over the plan catalogue so a manual override
 * (a comped account, a bespoke deal) is honoured rather than silently reset to
 * the tier default on the next check.
 */
export function limitFor(row: QuotaRow | null | undefined, now: Date = new Date()): number | null {
  if (!row) return null;
  // Checked FIRST, before posts_quota is even read. That ordering is the whole
  // design: the Stripe webhook keeps posts_quota faithfully in sync with the
  // plan on every event, and a comped account simply isn't measured against
  // it — so the override can't be clobbered by a renewal.
  if (row.comped) return null;
  // A live beta grant (migration 0033), also before posts_quota is read — and
  // for the same reason. A beta account has never checked out, so its
  // posts_quota is whatever the schema defaulted to, NOT what the coupon
  // granted; reading it would meter a 12-post beta at the default 4.
  // `effectiveBeta` returns null once a real subscription is live, so upgrading
  // mid-beta hands metering straight back to the plan the customer paid for.
  const beta = effectiveBeta(row, now);
  if (beta) return beta.postsQuota;
  // A price id that isn't in the catalogue means Stripe and lib/plans have
  // drifted. The row's quota is then whatever it happened to hold — often the
  // schema default of 4 — so enforcing it would throttle a customer who may be
  // paying for 150. Fail open and let the billing mismatch be fixed.
  if (row.stripe_price_id && !planForPriceId(row.stripe_price_id)) return null;
  const q = row.posts_quota;
  if (typeof q === 'number' && Number.isFinite(q) && q > 0) return Math.floor(q);
  if (isPlanId(row.plan)) return PLANS[row.plan].postsQuota;
  return null;
}

/** Start of the next monthly cycle (UTC). */
export function nextCycleReset(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

/** Has the cycle rolled over? An unset/unparseable boundary counts as due. */
export function cycleExpired(cycleResetsAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!cycleResetsAt) return true;
  const t = Date.parse(cycleResetsAt);
  if (!Number.isFinite(t)) return true;
  return now.getTime() >= t;
}

/** Current usage, with any due cycle reset already applied. */
export function quotaFrom(row: QuotaRow | null | undefined, now: Date = new Date()): QuotaState {
  const limit = limitFor(row, now);
  const expired = cycleExpired(row?.cycle_resets_at, now);
  const used = expired ? 0 : Math.max(0, Math.floor(row?.posts_used ?? 0));
  const resetsAt = expired ? nextCycleReset(now) : row!.cycle_resets_at!;
  if (limit === null) {
    return { enforced: false, limit: null, used, remaining: Infinity, exhausted: false, resetsAt };
  }
  const remaining = Math.max(0, limit - used);
  return { enforced: true, limit, used, remaining, exhausted: remaining <= 0, resetsAt };
}

/** The message a customer sees when they run out. */
export function exhaustedMessage(state: QuotaState): string {
  const when = new Date(state.resetsAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  return `You've used all ${state.limit} posts included this month. Your quota resets on ${when} — upgrade your plan for more.`;
}

// ── stored state ───────────────────────────────────────────────────────────

/** Read-only view of one user's quota. */
export async function getQuota(userId: string, client?: SupabaseClient): Promise<QuotaState> {
  const sb = client ?? supabaseAdmin();
  const { data } = await sb.from('subscriptions').select(SELECT).eq('user_id', userId).maybeSingle();
  return quotaFrom(data as QuotaRow | null);
}

/** Batch read for the scheduler, which resolves many owners per tick. */
export async function quotaForUsers(userIds: string[]): Promise<Map<string, QuotaState>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  const out = new Map<string, QuotaState>();
  if (!unique.length) return out;
  const sb = supabaseAdmin();
  const { data } = await sb.from('subscriptions').select(SELECT).in('user_id', unique);
  for (const row of data ?? []) out.set((row as any).user_id, quotaFrom(row as QuotaRow));
  return out;
}

/**
 * Split one owner's remaining allowance across their domains for planning.
 *
 * Two bugs live here, and both showed up on the owner's own account — a Starter
 * plan (12 posts/month) running two domains at 4 and 3 posts/week:
 *
 *  1. The allowance is per SUBSCRIPTION but planning ran per DOMAIN, gated only
 *     by a boolean "is this owner exhausted?". So every domain planned its full
 *     cadence against the same 12 posts — ~30 slots between them — and whichever
 *     domain the loop reached first took the lot.
 *
 *  2. `remaining` only falls when a post is actually GENERATED, not when it is
 *     planned. So each tick cheerfully planned another batch against an
 *     allowance the previous tick had already committed, and the queue grew far
 *     past anything the plan could pay for. That is why 8 posts sat `queued`
 *     and undrainable with posts_used pinned at 12/12.
 *
 * Subtracting what's already queued fixes (2); dividing the rest fixes (1).
 * The remainder goes to the earliest domains, which is stable across ticks —
 * exact per-domain fairness is `pickQueuedFairly`'s job at drain time, and it
 * already round-robins. What matters here is only that we never plan work the
 * allowance can't buy.
 */
export function shareAllowance(opts: {
  /** Quota left this cycle. `Infinity` when the account isn't enforced. */
  remaining: number;
  /** Owner's posts already planned but not yet generated. */
  alreadyQueued: number;
  /** The owner's domains, in a stable order (created_at ascending). */
  domainIds: string[];
  /** Ceiling per domain per tick, so one tick can't plan a whole month. */
  perDomainCap: number;
}): Map<string, number> {
  const { remaining, alreadyQueued, domainIds, perDomainCap } = opts;
  const out = new Map<string, number>();
  if (!domainIds.length || perDomainCap <= 0) return out;

  // Unenforced accounts keep today's behaviour: every domain gets the cap.
  if (!Number.isFinite(remaining)) {
    for (const id of domainIds) out.set(id, perDomainCap);
    return out;
  }

  const budget = Math.max(0, Math.floor(remaining) - Math.max(0, alreadyQueued));
  const n = domainIds.length;
  const base = Math.floor(budget / n);
  let leftover = budget - base * n;

  for (const id of domainIds) {
    const extra = leftover > 0 ? 1 : 0;
    leftover -= extra;
    out.set(id, Math.min(perDomainCap, base + extra));
  }
  return out;
}

/**
 * Reserve `n` posts against the cycle, atomically.
 *
 * Check-then-increment would let two concurrent generations both pass the check
 * on the last remaining post, so the write is a compare-and-swap against the
 * value we read: whoever loses re-reads and re-decides. Unresolved contention
 * after a few attempts fails open — a customer occasionally getting one extra
 * post is a far better outcome than a lost race blocking work they paid for.
 */
export async function consumeQuota(
  userId: string,
  n = 1,
): Promise<{ ok: boolean; state: QuotaState }> {
  const sb = supabaseAdmin();
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data } = await sb.from('subscriptions').select(SELECT).eq('user_id', userId).maybeSingle();
    const row = (data ?? null) as QuotaRow | null;
    const now = new Date();
    const state = quotaFrom(row, now);
    if (!state.enforced) return { ok: true, state };
    if (state.remaining < n) return { ok: false, state };

    const expired = cycleExpired(row?.cycle_resets_at, now);
    const patch: Record<string, unknown> = expired
      ? { posts_used: n, cycle_resets_at: nextCycleReset(now) }
      : { posts_used: state.used + n };

    const base = sb.from('subscriptions').update(patch).eq('user_id', userId);
    // Compare-and-swap on whichever field this write is racing for: the cycle
    // boundary when rolling the month over (so exactly one caller resets it),
    // the counter otherwise (so no increment is lost).
    const guarded = expired
      ? (row?.cycle_resets_at
          ? base.eq('cycle_resets_at', row.cycle_resets_at)
          : base.is('cycle_resets_at', null))
      : base.eq('posts_used', row?.posts_used ?? 0);

    const { data: won } = await guarded.select('user_id').maybeSingle();
    if (won) {
      const used = state.used + n;
      const remaining = Math.max(0, (state.limit ?? 0) - used);
      return { ok: true, state: { ...state, used, remaining, exhausted: remaining <= 0 } };
    }
  }
  return { ok: true, state: await getQuota(userId) };
}

/**
 * Hand back reservations whose work failed — the customer got nothing, so the
 * post shouldn't come out of their month. Best-effort: bookkeeping must never
 * turn into a second failure on an already-failing path.
 */
export async function releaseQuota(userId: string, n = 1): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb.from('subscriptions').select('posts_used').eq('user_id', userId).maybeSingle();
    const used = Math.max(0, Math.floor((data as any)?.posts_used ?? 0));
    await sb.from('subscriptions').update({ posts_used: Math.max(0, used - n) }).eq('user_id', userId);
  } catch { /* never mask the caller's real error */ }
}

/**
 * Route-handler convenience, mirroring enforceRateLimit: reserves the quota and
 * returns a 402 when there isn't any left, or null when the caller may proceed.
 *
 *   const over = await enforceQuota(user.id);
 *   if (over) return over;
 */
export async function enforceQuota(userId: string, n = 1): Promise<NextResponse | null> {
  const { ok, state } = await consumeQuota(userId, n);
  if (ok) return null;
  // The upgrade moment, captured where it actually happens. A customer who
  // hits this repeatedly is either ready for a bigger plan or about to churn,
  // and those two look identical without the event.
  await captureServer(userId, 'quota_exhausted', { limit: state.limit, used: state.used });
  return NextResponse.json(
    {
      error: 'quota_exhausted',
      message: exhaustedMessage(state),
      limit: state.limit,
      used: state.used,
      resets_at: state.resetsAt,
    },
    { status: 402 },
  );
}
