/**
 * SERVER-ONLY reads over the beta tables (migration 0033).
 *
 * Split from lib/beta.ts for the same reason feedback-store is split from
 * feedback: lib/beta.ts is imported by client components (the redeem box reads
 * its refusal copy from there) and must never pull in the service-role client.
 *
 * `beta_coupons` has RLS enabled with no policy at all, so these reads are the
 * ONLY way to see a code — there is no user-key path to enumerate them. Every
 * function is best-effort and returns empty rather than throwing, so the admin
 * views still render before migration 0033 is applied.
 */
import { supabaseAdmin } from './supabase/admin';
import { betaStateFrom, couponProblem, type CouponProblem } from './beta';

export type CouponRecord = {
  id: string;
  code: string;
  label: string | null;
  posts_quota: number;
  days: number;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** A coupon plus the verdict the redeem endpoint would give it right now. */
export type CouponWithState = CouponRecord & {
  /** null when the code is currently redeemable. */
  problem: CouponProblem | null;
  /** Redemptions left, or null when uncapped. */
  remaining: number | null;
};

export async function listCoupons(limit = 100): Promise<CouponWithState[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('beta_coupons')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as CouponRecord[]).map((c) => ({
      ...c,
      // Computed with the SAME function the redeem endpoint uses, so the admin
      // list can never say "live" about a code that would be refused. A status
      // column recomputed by hand here is exactly how those two drift.
      problem: couponProblem(c),
      remaining: c.max_redemptions === null ? null : Math.max(0, c.max_redemptions - (c.redeemed_count ?? 0)),
    }));
  } catch {
    return [];
  }
}

export type BetaStats = {
  /** Grants that haven't expired yet. */
  active: number;
  /** Every redemption ever made. */
  redeemed: number;
  /** Grants that ran out — the conversion pool. */
  expired: number;
  /** Free posts/month currently promised to live beta accounts. */
  committedPostsPerMonth: number;
};

export const EMPTY_BETA_STATS: BetaStats = {
  active: 0, redeemed: 0, expired: 0, committedPostsPerMonth: 0,
};

/**
 * How much free access is outstanding.
 *
 * Read off `subscriptions`, not `beta_redemptions`: the grant on the
 * subscription is what the readers actually honour, and it can be extended or
 * cleared by hand. Counting redemptions would report what was handed out rather
 * than what is currently being served — and the second number is the one that
 * competes with paying customers for generation capacity.
 */
export async function betaStats(now: Date = new Date()): Promise<BetaStats> {
  try {
    const { data } = await supabaseAdmin()
      .from('subscriptions')
      .select('beta_code, beta_expires_at, beta_posts_quota, stripe_status')
      .not('beta_expires_at', 'is', null);

    const out = { ...EMPTY_BETA_STATS };
    for (const row of data ?? []) {
      const state = betaStateFrom(row, now);
      if (!state.present) continue;
      out.redeemed++;
      if (state.active) {
        out.active++;
        out.committedPostsPerMonth += state.postsQuota;
      } else {
        out.expired++;
      }
    }
    return out;
  } catch {
    return EMPTY_BETA_STATS;
  }
}
