/**
 * Plan catalogue — the single source of truth for what each tier is called,
 * costs, and grants. Display fields are safe to import into client components.
 *
 * Prices themselves live in Stripe; we only ever reference Stripe *price IDs*
 * (server-side, from env) so the client can never influence the amount charged.
 */

export type PlanId = 'starter' | 'growth' | 'agency';

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;        // monthly, for display only
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

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (v as PlanId) in PLANS;
}

export const FREE_PLAN: { id: 'free'; name: string; postsQuota: number } = {
  id: 'free',
  name: 'Free',
  postsQuota: 0,
};

/**
 * SERVER-ONLY. Resolve a plan id to its configured Stripe price id.
 * Never expose these env vars to the client (no NEXT_PUBLIC_ prefix).
 */
export function priceIdForPlan(plan: PlanId): string | undefined {
  const map: Record<PlanId, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    agency: process.env.STRIPE_PRICE_AGENCY,
  };
  return map[plan];
}

/** SERVER-ONLY. Reverse-resolve a Stripe price id back to a plan id (for the webhook). */
export function planForPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const id of PLAN_IDS) {
    if (priceIdForPlan(id) === priceId) return id;
  }
  return null;
}
