/**
 * Free beta grants — pure logic, no DB, no env, no secrets.
 *
 * Client-safe: the redeem form imports the normaliser and the rejection copy so
 * the message a customer reads is the same string the server decided on.
 *
 * A beta grant is BOUNDED on two axes, and that is the whole design (see
 * migration 0033). `comped` means "not metered at all" and is right for the
 * founder's own account; a public beta code handed to strangers has to expire
 * and has to be metered, because platform capacity is a fixed ~720 posts/month
 * across every account and an unmetered guest spends a paying customer's share.
 *
 * Precedence, settled here once so quota and entitlement can't disagree:
 *
 *   comped        →  wins over everything (internal accounts never go dark)
 *   live Stripe   →  wins over a beta grant (they upgraded — give them what
 *                    they paid for, not whichever number happens to be bigger)
 *   beta grant    →  wins over the plan catalogue and over posts_quota
 *   otherwise     →  today's behaviour, untouched
 */

/* ───────────────────────────── coupon codes ─────────────────────────────── */

/**
 * The stored form of a code: upper case, letters and digits only.
 *
 * Codes get typed by hand off a tweet, a slide or a DM, so "grove-beta",
 * "GROVE BETA" and "GroveBeta" have to be one coupon rather than three misses.
 * Applied before both lookup and insert — a coupon whose stored code isn't
 * normalised could never be redeemed.
 */
export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Characters a generated code may contain.
 *
 * No 0/O, 1/I/L, 5/S, 8/B — these codes get read off a slide, a podcast or a
 * DM and typed by hand, and every one of those pairs is a redemption that
 * silently fails and a tester we never hear from. The 26 survivors give ~4.7
 * bits each; at length 10 that is ~47 bits, far past anything the 10/hour rate
 * limit could be walked through.
 */
const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY234679';

/**
 * A fresh, hard-to-guess coupon code. `rand` is injectable so tests can pin the
 * output; production passes crypto-backed randomness from the route.
 */
export function randomCode(length = 10, rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return out;
}

/** Cosmetic grouping for display only — never stored, never compared. */
export function formatCode(code: string): string {
  const c = normalizeCode(code);
  if (c.length <= 8) return c;
  return (c.match(/.{1,4}/g) ?? [c]).join('-');
}

export type CouponRow = {
  code?: string | null;
  active?: boolean | null;
  expires_at?: string | null;
  max_redemptions?: number | null;
  redeemed_count?: number | null;
  posts_quota?: number | null;
  days?: number | null;
};

/** Why a code was refused. `null` from `couponProblem` means it's good. */
export type CouponProblem = 'unknown' | 'inactive' | 'expired' | 'exhausted' | 'already_redeemed';

/**
 * Customer-facing copy for each refusal.
 *
 * Deliberately vague about *why* an unknown code failed: "expired" and "never
 * existed" read the same, so a stranger guessing at codes learns nothing from
 * the difference. The owner sees the real reason in the admin view.
 */
export const COUPON_PROBLEM_MESSAGE: Record<CouponProblem, string> = {
  unknown: "That code isn't valid. Check for a typo, or ask whoever sent it for a fresh one.",
  inactive: "That code isn't valid. Check for a typo, or ask whoever sent it for a fresh one.",
  expired: 'That code has expired. Ask whoever sent it for a current one.',
  exhausted: 'That code has been fully claimed. Ask whoever sent it for a fresh one.',
  already_redeemed:
    "You've already used a beta code on this account. Pick a plan to keep publishing — everything you've made stays where it is.",
};

/** Is this coupon redeemable right now? Returns the problem, or null if fine. */
export function couponProblem(
  row: CouponRow | null | undefined,
  now: Date = new Date(),
): CouponProblem | null {
  if (!row) return 'unknown';
  if (row.active === false) return 'inactive';
  if (row.expires_at) {
    const t = Date.parse(row.expires_at);
    // An unparseable expiry is treated as expired rather than ignored: the safe
    // failure for a giveaway is "doesn't work", never "works forever".
    if (!Number.isFinite(t) || now.getTime() >= t) return 'expired';
  }
  const max = row.max_redemptions;
  if (typeof max === 'number' && Number.isFinite(max) && max > 0) {
    if (Math.max(0, row.redeemed_count ?? 0) >= max) return 'exhausted';
  }
  return null;
}

/** Fallbacks for a coupon row missing its numbers — same as the table defaults. */
export const DEFAULT_BETA_POSTS_QUOTA = 12;
export const DEFAULT_BETA_DAYS = 30;

export type BetaGrant = {
  code: string;
  postsQuota: number;
  /** ISO — when free access ends. */
  expiresAt: string;
};

/** What redeeming this coupon right now would grant. */
export function grantFor(coupon: CouponRow, now: Date = new Date()): BetaGrant {
  const days = positiveInt(coupon.days, DEFAULT_BETA_DAYS);
  const postsQuota = positiveInt(coupon.posts_quota, DEFAULT_BETA_POSTS_QUOTA);
  return {
    code: normalizeCode(coupon.code),
    postsQuota,
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  };
}

function positiveInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/* ─────────────────────────── the grant, once held ───────────────────────── */

export type BetaRow = {
  beta_code?: string | null;
  beta_expires_at?: string | null;
  beta_posts_quota?: number | null;
  stripe_status?: string | null;
};

export type BetaState = {
  /** Held a grant at some point (live or not) — drives "your beta ended" copy. */
  present: boolean;
  /** Live right now: not expired. Says nothing about Stripe precedence. */
  active: boolean;
  code: string | null;
  postsQuota: number;
  expiresAt: string | null;
  /** Whole days remaining, rounded up; 0 once expired. */
  daysLeft: number;
};

const NO_BETA: BetaState = {
  present: false, active: false, code: null,
  postsQuota: DEFAULT_BETA_POSTS_QUOTA, expiresAt: null, daysLeft: 0,
};

/**
 * Read a subscription row's beta grant.
 *
 * Tolerates the pre-migration state on purpose: before 0033 is applied the
 * columns simply aren't there, every field reads `undefined`, and this returns
 * "no beta" — which is exactly today's behaviour. Same defence as `comped`.
 */
export function betaStateFrom(row: BetaRow | null | undefined, now: Date = new Date()): BetaState {
  if (!row?.beta_expires_at) return NO_BETA;
  const t = Date.parse(row.beta_expires_at);
  // An unparseable expiry must not read as "never expires" — a grant we can't
  // date is a grant we stop honouring.
  if (!Number.isFinite(t)) return NO_BETA;
  const msLeft = t - now.getTime();
  return {
    present: true,
    active: msLeft > 0,
    code: row.beta_code ? normalizeCode(row.beta_code) : null,
    postsQuota: positiveInt(row.beta_posts_quota, DEFAULT_BETA_POSTS_QUOTA),
    expiresAt: row.beta_expires_at,
    daysLeft: msLeft > 0 ? Math.ceil(msLeft / 86_400_000) : 0,
  };
}

/**
 * Statuses where Stripe outranks a beta grant.
 *
 * Only genuinely live ones. `past_due` is excluded deliberately: a customer
 * mid-card-retry who still has beta days left should keep publishing on the
 * beta rather than be cut off, and the beta grant is the more generous branch
 * precisely when their payment is in doubt.
 */
const LIVE_STRIPE = new Set(['active', 'trialing']);

/** Has this account a paid subscription that should take precedence? */
export function hasLivePaidSubscription(row: { stripe_status?: string | null } | null | undefined): boolean {
  return LIVE_STRIPE.has((row?.stripe_status ?? '').toLowerCase());
}

/**
 * The beta grant currently in force, or null.
 *
 * Null both when there is no grant and when a paid subscription supersedes one
 * — callers asking "how should this account be metered" only ever want the
 * branch that actually applies.
 */
export function effectiveBeta(row: BetaRow | null | undefined, now: Date = new Date()): BetaState | null {
  if (hasLivePaidSubscription(row)) return null;
  const state = betaStateFrom(row, now);
  return state.active ? state : null;
}

/** "6 days left" / "last day" / "ended" — one phrasing, used by every surface. */
export function betaWindowLabel(state: BetaState): string {
  if (!state.present) return '';
  if (!state.active) return 'Beta access ended';
  if (state.daysLeft <= 1) return 'Last day of your beta';
  return `${state.daysLeft} days left in your beta`;
}
