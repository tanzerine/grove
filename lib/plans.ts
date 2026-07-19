/**
 * Plan catalogue — the single source of truth for what each tier is called,
 * costs, and grants. Display fields are safe to import into client components.
 *
 * Prices themselves live in Stripe; we only ever reference Stripe *price IDs*
 * (server-side, from env) so the client can never influence the amount charged.
 */

export type PlanId = 'starter' | 'growth' | 'agency';

/** How often the customer is billed. Quota/entitlements are identical for both. */
export type BillingInterval = 'month' | 'year';

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;        // monthly list price, for display only
  postsQuota: number;      // posts / month this tier grants
  blurb: string;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceUsd: 29,
    postsQuota: 12,
    blurb: 'For a single site finding its footing.',
    features: ['12 posts / month', '1 domain', 'Full SEO pipeline', 'Email support'],
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceUsd: 79,
    postsQuota: 40,
    blurb: 'For sites compounding traffic month over month.',
    features: ['40 posts / month', 'Up to 3 domains', 'Social auto-publish', 'Search Console insights'],
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceUsd: 199,
    postsQuota: 150,
    blurb: 'For teams running blogs at scale.',
    features: ['150 posts / month', 'Unlimited domains', 'Priority pipeline', 'Priority support'],
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

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
