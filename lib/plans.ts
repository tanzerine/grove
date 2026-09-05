/**
 * Plan catalogue — the single source of truth for what each tier is called,
 * costs, and grants. Display fields are safe to import into client components.
 *
 * Prices themselves live in Stripe; we only ever reference Stripe *price IDs*
 * (server-side, from env) so the client can never influence the amount charged.
 *
 * `blurb` and `features` are customer-facing copy, rendered on the landing's
 * pricing table and on /dashboard/billing. They are marked with `msg` and
 * translated at those two render sites: this table is module-level, evaluated
 * once per process, so a `t` call here would freeze whichever locale loaded
 * the module first and serve it to everyone. Plan NAMES stay untranslated —
 * "Starter" is what the Stripe invoice and the support conversation call it.
 */
import { msg } from './i18n';

export type PlanId = 'starter' | 'growth' | 'agency';

/** How often the customer is billed. Quota/entitlements are identical for both. */
export type BillingInterval = 'month' | 'year';

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;        // monthly list price, for display only
  postsQuota: number;      // posts / month this tier grants
  /**
   * Domains this tier may connect; `null` = unlimited.
   *
   * This used to exist ONLY as prose in `features` below — "1 domain", "Up to
   * 3 domains" — with no check anywhere in the codebase. `POST /api/domains`
   * inserted unconditionally, so a $29 Starter account could connect as many
   * sites as it liked. That made the domain count decorative on all three
   * tiers and left Growth with no capability a Starter customer couldn't
   * already help themselves to.
   *
   * Keep this in step with the `features` copy — the string is what the
   * customer is promised, this is what they get.
   */
  domainLimit: number | null;
  blurb: string;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceUsd: 29,
    postsQuota: 12,
    domainLimit: 1,
    blurb: msg('One site, publishing about three times a week.'),
    features: [msg('12 posts / month'), msg('1 domain'), msg('Full SEO pipeline'), msg('Email support')],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceUsd: 79,
    postsQuota: 40,
    domainLimit: 3,
    blurb: msg('Up to three sites, publishing daily.'),
    features: [msg('40 posts / month'), msg('Up to 3 domains'), msg('Social auto-publish'), msg('Search Console insights')],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceUsd: 199,
    postsQuota: 150,
    domainLimit: null,
    blurb: msg('Agencies and teams running many client blogs.'),
    features: [msg('150 posts / month'), msg('Unlimited domains'), msg('Priority pipeline'), msg('Priority support')],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/**
 * Weeks in a month, as the strategist counts them when spreading a monthly
 * publishing plan. Shared with lib/strategy/build so the cadence a customer
 * picks and the number of slots that plan produces can't drift apart.
 */
export const WEEKS_PER_MONTH = 4.3;

/**
 * Highest weekly cadence a monthly allowance can sustain.
 *
 * Cadence (per week) and quota (per month) don't divide evenly, and they used
 * to be set independently: a Starter account on the default 3/week produced
 * round(3 × 4.3) = 13 planned slots against an allowance of 12, so one slot was
 * deferred as over-quota every single month. Worse, nothing stopped a Starter
 * customer choosing 7/week — 30 slots against those same 12.
 *
 * Rounded UP, deliberately. The floor (2/week for Starter) would plan only 9
 * posts against an allowance of 12 and under-deliver by a quarter; the ceiling
 * plans slightly over and lets `monthlySlots` trim the tail back to exactly the
 * allowance, so the customer gets every post they paid for and no more.
 */
export function maxPostsPerWeekForQuota(postsQuota: number): number {
  if (!Number.isFinite(postsQuota) || postsQuota <= 0) return 1;
  return Math.max(1, Math.ceil(postsQuota / WEEKS_PER_MONTH));
}

/** Highest weekly cadence a plan allows. */
export function maxPostsPerWeek(plan: PlanId): number {
  return maxPostsPerWeekForQuota(PLANS[plan].postsQuota);
}

/**
 * How many slots a month's publishing plan should hold.
 *
 * The cadence sets the shape, the monthly allowance sets the ceiling. Planning
 * past the allowance only manufactures work the drain will refuse, so the plan
 * is trimmed to what the customer can actually be given. A null quota means
 * "not enforced" (see lib/quota) and leaves the cadence alone.
 */
export function monthlySlots(postsPerWeek: number, postsQuota?: number | null): number {
  const fromCadence = Math.max(4, Math.round(postsPerWeek * WEEKS_PER_MONTH));
  if (typeof postsQuota !== 'number' || !Number.isFinite(postsQuota) || postsQuota <= 0) {
    return fromCadence;
  }
  return Math.min(fromCadence, Math.floor(postsQuota));
}

/* ───────────────────────────── domain allowance ─────────────────────────── */

/**
 * Statuses that entitle an account to its plan's domain ceiling.
 *
 * `past_due` is included deliberately. Existing domains are grandfathered
 * either way (see canAddDomain — this gates ADDING, never keeping), so the only
 * question is whether a customer mid-card-retry may connect another site.
 * Demoting them to the entry ceiling over a payment Stripe is still retrying is
 * punitive for no gain.
 */
const DOMAIN_LIMIT_STATUSES = new Set(['active', 'trialing', 'past_due']);

export type DomainLimitRow = {
  plan?: string | null;
  stripe_status?: string | null;
  stripe_price_id?: string | null;
  /** Not metered at all — see migration 0030. */
  comped?: boolean | null;
};

/**
 * SERVER-ONLY (reads the Stripe price catalogue from env).
 *
 * How many domains this subscription may connect; `null` means "don't
 * enforce". Same failure philosophy as lib/quota's `limitFor`: when Stripe and
 * our catalogue have drifted we decline to enforce at all, because blocking a
 * paying customer over our own misconfiguration is worse than briefly
 * over-delivering.
 *
 * An account with no live subscription gets the entry ceiling rather than
 * `null`: onboarding connects exactly one site, and every paid tier sells the
 * second one, so "unlimited until you pay us" is the wrong default.
 */
export function domainLimitFor(row: DomainLimitRow | null | undefined): number | null {
  if (!row) return PLANS.starter.domainLimit;
  // Comped accounts aren't metered on anything (migration 0030). Checked before
  // plan and status so a lapsed or mismatched Stripe row can't re-impose a
  // ceiling on an account we deliberately exempted.
  if (row.comped) return null;
  if (row.stripe_price_id && !planForPriceId(row.stripe_price_id)) return null;
  const status = (row.stripe_status ?? '').toLowerCase();
  if (!DOMAIN_LIMIT_STATUSES.has(status)) return PLANS.starter.domainLimit;
  if (isPlanId(row.plan)) return PLANS[row.plan].domainLimit;
  return PLANS.starter.domainLimit;
}

/**
 * May this account connect one more domain?
 *
 * Note what this deliberately does NOT do: it never asks whether the account is
 * already over its ceiling in a way that would remove anything. Accounts that
 * accumulated domains while this was unenforced keep every one of them and keep
 * publishing — they simply can't add another until they upgrade. Taking a live
 * blog away from a paying customer to correct our own past permissiveness is
 * not a trade worth making.
 */
export function canAddDomain(limit: number | null, currentCount: number): boolean {
  if (limit === null) return true;
  return currentCount < limit;
}

/** Human-readable ceiling for UI copy: "1 domain" / "3 domains" / "unlimited". */
export function describeDomainLimit(limit: number | null): string {
  if (limit === null) return 'unlimited domains';
  return `${limit} domain${limit === 1 ? '' : 's'}`;
}

/** The cheapest plan that allows `count` domains, or null if none does. */
export function smallestPlanForDomains(count: number): PlanId | null {
  const ordered = PLAN_IDS.slice().sort((a, b) => PLANS[a].priceUsd - PLANS[b].priceUsd);
  return ordered.find((id) => canAddDomain(PLANS[id].domainLimit, count - 1)) ?? null;
}

export const BILLING_INTERVALS: BillingInterval[] = ['month', 'year'];

/** Annual commitment discount, applied to the monthly list price. */
export const ANNUAL_DISCOUNT = 0.2;

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (v as PlanId) in PLANS;
}

export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year';
}

/**
 * Per-month price to DISPLAY for a plan on a given interval. Annual plans show
 * the discounted monthly equivalent ("$23 /mo, billed annually"), which is what
 * both the landing page and the billing page render.
 */
export function monthlyPriceUsd(plan: PlanId, interval: BillingInterval): number {
  const monthly = PLANS[plan].priceUsd;
  return interval === 'year' ? Math.round(monthly * (1 - ANNUAL_DISCOUNT)) : monthly;
}

/** Total charged once a year on the annual interval. Must match the Stripe price. */
export function yearlyPriceUsd(plan: PlanId): number {
  return monthlyPriceUsd(plan, 'year') * 12;
}

/** "$1,908" — comma-grouped for the yearly total, which runs into 4 digits. */
export function formatUsd(n: number): string {
  return n.toLocaleString('en-US');
}

export const FREE_PLAN: { id: 'free'; name: string; postsQuota: number } = {
  id: 'free',
  name: 'Free',
  postsQuota: 0,
};

/**
 * SERVER-ONLY. Resolve a plan + interval to its configured Stripe price id.
 * Never expose these env vars to the client (no NEXT_PUBLIC_ prefix).
 */
export function priceIdFor(plan: PlanId, interval: BillingInterval = 'month'): string | undefined {
  const monthly: Record<PlanId, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    agency: process.env.STRIPE_PRICE_AGENCY,
  };
  const yearly: Record<PlanId, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER_YEARLY,
    growth: process.env.STRIPE_PRICE_GROWTH_YEARLY,
    agency: process.env.STRIPE_PRICE_AGENCY_YEARLY,
  };
  return (interval === 'year' ? yearly : monthly)[plan];
}

/** @deprecated use priceIdFor(plan, interval). Kept for the monthly-only callers. */
export function priceIdForPlan(plan: PlanId): string | undefined {
  return priceIdFor(plan, 'month');
}

/**
 * SERVER-ONLY. Reverse-resolve a Stripe price id back to plan + interval. The
 * subscription's price id is the only place the interval is recorded, so this
 * is how the webhook and admin stats tell a yearly sub from a monthly one.
 */
export function resolvePriceId(
  priceId: string | null | undefined,
): { plan: PlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const interval of BILLING_INTERVALS) {
    for (const id of PLAN_IDS) {
      if (priceIdFor(id, interval) === priceId) return { plan: id, interval };
    }
  }
  return null;
}

/** SERVER-ONLY. Plan id for a Stripe price id, on either interval. */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  return resolvePriceId(priceId)?.plan ?? null;
}
