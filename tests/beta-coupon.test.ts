/**
 * Free beta grants — the coupon, the grant, and above all the PRECEDENCE.
 *
 * A beta grant sits between two things that already decide how an account is
 * metered (`comped` from 0030, and the Stripe subscription), so the tests that
 * matter most are the ones pinning which wins. Getting that order wrong is not
 * a cosmetic bug: one direction gives strangers unmetered access to a platform
 * with a fixed ~720 posts/month ceiling, the other silently downgrades someone
 * the moment they pay us.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCode,
  formatCode,
  randomCode,
  couponProblem,
  grantFor,
  betaStateFrom,
  effectiveBeta,
  hasLivePaidSubscription,
  betaWindowLabel,
  COUPON_PROBLEM_MESSAGE,
  DEFAULT_BETA_POSTS_QUOTA,
} from '../lib/beta';
import { limitFor, quotaFrom } from '../lib/quota';
import { entitlementFrom } from '../lib/billing';

const NOW = new Date('2026-08-07T12:00:00Z');
const IN_10_DAYS = '2026-08-17T12:00:00Z';
const YESTERDAY = '2026-08-06T12:00:00Z';
// A cycle that hasn't rolled over: quotaFrom treats an unset boundary as due
// and zeroes `used`, which would make "exhausted" unreachable.
const THIS_CYCLE = '2026-09-01T00:00:00Z';

/** A live beta grant: 12 posts/month, ten days left, never checked out. */
const LIVE_BETA = {
  beta_code: 'GROVEBETA',
  beta_expires_at: IN_10_DAYS,
  beta_posts_quota: 12,
  posts_quota: 4, // the schema default a never-checked-out row actually carries
  cycle_resets_at: THIS_CYCLE,
};

describe('code normalisation', () => {
  it('folds the ways a human retypes the same code', () => {
    // These all get typed off a slide, a tweet or a DM. If they aren't one
    // coupon they are three silent redemption failures.
    for (const raw of ['grove-beta', 'GROVE BETA', 'GroveBeta', ' grove_beta ']) {
      expect(normalizeCode(raw)).toBe('GROVEBETA');
    }
  });

  it('survives nothing at all', () => {
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode('!!!')).toBe('');
  });

  it('formats for display without changing what is compared', () => {
    expect(formatCode('ABCDEFGHIJ')).toBe('ABCD-EFGH-IJ');
    expect(normalizeCode(formatCode('ABCDEFGHIJ'))).toBe('ABCDEFGHIJ');
    expect(formatCode('SHORT')).toBe('SHORT');
  });

  it('generates codes free of glyphs people confuse', () => {
    // 0/O, 1/I/L, 5/S, 8/B are the pairs that turn a redemption into a support
    // ticket. Sampled across the whole alphabet, not one draw.
    const sample = Array.from({ length: 200 }, (_, i) => randomCode(10, () => i / 200)).join('');
    expect(sample).not.toMatch(/[O01IL5S8B]/);
    expect(randomCode(8, () => 0)).toHaveLength(8);
    // Already normalised, so a generated code can always be redeemed.
    expect(normalizeCode(randomCode(10, () => 0.42))).toBe(randomCode(10, () => 0.42));
  });
});

describe('coupon validity', () => {
  const good = { code: 'X', active: true, max_redemptions: 10, redeemed_count: 3 };

  it('accepts a live, uncapped, unexpired code', () => {
    expect(couponProblem(good, NOW)).toBeNull();
    expect(couponProblem({ active: true }, NOW)).toBeNull();
  });

  it('refuses unknown, inactive, expired and exhausted codes', () => {
    expect(couponProblem(null, NOW)).toBe('unknown');
    expect(couponProblem({ ...good, active: false }, NOW)).toBe('inactive');
    expect(couponProblem({ ...good, expires_at: YESTERDAY }, NOW)).toBe('expired');
    expect(couponProblem({ ...good, redeemed_count: 10 }, NOW)).toBe('exhausted');
    expect(couponProblem({ ...good, redeemed_count: 11 }, NOW)).toBe('exhausted');
  });

  it('treats an undatable expiry as expired, never as forever', () => {
    // The safe failure for a giveaway is "doesn't work". A garbled timestamp
    // must not read as an unlimited code.
    expect(couponProblem({ ...good, expires_at: 'not-a-date' }, NOW)).toBe('expired');
  });

  it('tells an unknown code and an expired one apart only to us', () => {
    // A stranger guessing at codes must learn nothing from the difference.
    expect(COUPON_PROBLEM_MESSAGE.unknown).toBe(COUPON_PROBLEM_MESSAGE.inactive);
  });

  it('uncapped codes never exhaust', () => {
    expect(couponProblem({ active: true, redeemed_count: 9999 }, NOW)).toBeNull();
  });
});

describe('grantFor', () => {
  it('dates the grant from redemption, not from a fixed calendar end', () => {
    const g = grantFor({ code: 'launch-25', posts_quota: 20, days: 14 }, NOW);
    expect(g.code).toBe('LAUNCH25');
    expect(g.postsQuota).toBe(20);
    expect(g.expiresAt).toBe('2026-08-21T12:00:00.000Z');
  });

  it('falls back to the table defaults when the coupon is missing numbers', () => {
    const g = grantFor({ code: 'X' }, NOW);
    expect(g.postsQuota).toBe(DEFAULT_BETA_POSTS_QUOTA);
    expect(new Date(g.expiresAt).getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('reading a grant off a subscription row', () => {
  it('reports a live grant with days remaining', () => {
    const s = betaStateFrom(LIVE_BETA, NOW);
    expect(s).toMatchObject({ present: true, active: true, code: 'GROVEBETA', postsQuota: 12, daysLeft: 10 });
    expect(betaWindowLabel(s)).toBe('10 days left in your beta');
  });

  it('separates "expired" from "never had one"', () => {
    // Both are blocked, but only the first has seen the product work — which is
    // the most convertible state a customer is ever in.
    const lapsed = betaStateFrom({ ...LIVE_BETA, beta_expires_at: YESTERDAY }, NOW);
    expect(lapsed).toMatchObject({ present: true, active: false, daysLeft: 0 });
    expect(betaWindowLabel(lapsed)).toBe('Beta access ended');

    const never = betaStateFrom({ posts_quota: 4 }, NOW);
    expect(never).toMatchObject({ present: false, active: false });
    expect(betaWindowLabel(never)).toBe('');
  });

  it('says "last day" rather than "1 days left"', () => {
    const s = betaStateFrom({ ...LIVE_BETA, beta_expires_at: '2026-08-07T20:00:00Z' }, NOW);
    expect(s.daysLeft).toBe(1);
    expect(betaWindowLabel(s)).toBe('Last day of your beta');
  });

  it('reads as no-beta before migration 0033 is applied', () => {
    // The columns simply aren't there, every field is undefined, and behaviour
    // has to be exactly today's. Same defence as `comped`.
    expect(betaStateFrom({ plan: 'starter', posts_quota: 12 }, NOW).present).toBe(false);
    expect(betaStateFrom(null, NOW).present).toBe(false);
    expect(betaStateFrom(undefined, NOW).present).toBe(false);
  });

  it('stops honouring a grant it cannot date', () => {
    expect(betaStateFrom({ beta_expires_at: 'whenever' }, NOW).present).toBe(false);
  });
});

describe('precedence: comped > live Stripe > beta > plan', () => {
  it('comped still wins — a beta grant cannot re-impose metering', () => {
    expect(limitFor({ ...LIVE_BETA, comped: true }, NOW)).toBeNull();
    expect(entitlementFrom({ ...LIVE_BETA, comped: true }, NOW).reason).toBe('comped');
  });

  it('paying wins over a beta grant', () => {
    // Someone who upgrades mid-beta gets the plan they paid for, not whichever
    // number happens to be bigger — and reads as 'paying' so the revenue
    // analytics stay honest about who is funding us.
    const upgraded = { ...LIVE_BETA, stripe_status: 'active', plan: 'growth', posts_quota: 40 };
    expect(effectiveBeta(upgraded, NOW)).toBeNull();
    expect(limitFor(upgraded, NOW)).toBe(40);
    expect(entitlementFrom(upgraded, NOW).reason).toBe('paying');
  });

  it('a beta grant survives past_due', () => {
    // Mid-card-retry is exactly when the more generous branch should apply.
    const pastDue = { ...LIVE_BETA, stripe_status: 'past_due' };
    expect(hasLivePaidSubscription(pastDue)).toBe(false);
    expect(entitlementFrom(pastDue, NOW).canGenerate).toBe(true);
    expect(limitFor(pastDue, NOW)).toBe(12);
  });

  it('the grant is metered, not unmetered', () => {
    // The whole reason this isn't `comped`: platform capacity is fixed, so an
    // unmetered guest spends a paying customer's share.
    const state = quotaFrom(LIVE_BETA, NOW);
    expect(state.enforced).toBe(true);
    expect(state.limit).toBe(12);
    expect(state.remaining).toBe(12);
  });

  it('meters against the granted quota, not the row default', () => {
    // The bug this ordering exists to prevent: a beta account never checked
    // out, so posts_quota is the schema default. Reading it would meter a
    // 12-post beta at 4.
    expect(LIVE_BETA.posts_quota).toBe(4);
    expect(limitFor(LIVE_BETA, NOW)).toBe(12);
  });

  it('runs out like any other allowance', () => {
    const spent = { ...LIVE_BETA, posts_used: 12 };
    expect(quotaFrom(spent, NOW).exhausted).toBe(true);
    expect(quotaFrom({ ...spent, posts_used: 11 }, NOW).exhausted).toBe(false);
  });

  it('leaves every non-beta account exactly as it was', () => {
    expect(limitFor({ plan: 'starter', posts_quota: 12 }, NOW)).toBe(12);
    expect(limitFor({ plan: 'growth', posts_quota: 40, stripe_status: 'active' }, NOW)).toBe(40);
    expect(entitlementFrom({ stripe_status: 'active', plan: 'starter' }, NOW).reason).toBe('paying');
    expect(entitlementFrom(null, NOW).reason).toBe('no_subscription');
    expect(entitlementFrom({ stripe_status: 'canceled' }, NOW).reason).toBe('not_paying');
  });
});

describe('entitlement across the beta lifecycle', () => {
  it('grants generation while live', () => {
    expect(entitlementFrom(LIVE_BETA, NOW)).toEqual({ canGenerate: true, reason: 'beta' });
  });

  it('blocks with a distinguishable reason once it lapses', () => {
    // 'beta_expired' rather than 'no_subscription': the paywall copy and the
    // funnel both need to tell a lapsed tester from a stranger.
    const lapsed = { ...LIVE_BETA, beta_expires_at: YESTERDAY };
    expect(entitlementFrom(lapsed, NOW)).toEqual({ canGenerate: false, reason: 'beta_expired' });
  });

  it('a lapsed beta who then pays is simply paying', () => {
    const converted = { ...LIVE_BETA, beta_expires_at: YESTERDAY, stripe_status: 'active', plan: 'starter' };
    expect(entitlementFrom(converted, NOW).reason).toBe('paying');
  });

  it('expires exactly on the boundary, not after it', () => {
    const atBoundary = { ...LIVE_BETA, beta_expires_at: NOW.toISOString() };
    expect(betaStateFrom(atBoundary, NOW).active).toBe(false);
    expect(entitlementFrom(atBoundary, NOW).canGenerate).toBe(false);
  });
});
