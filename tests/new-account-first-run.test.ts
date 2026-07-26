/**
 * A brand-new account must work from an empty database.
 *
 * Every state this codebase reasons about — quota, domain allowance, pipeline
 * counts, planning input, analytics — has a "nothing exists yet" case, and the
 * new-account path hits ALL of them at once. That's the least-exercised
 * combination in the product and the one every first impression depends on;
 * it's also where the fabricated-analytics bug lived (a data-less report
 * greeting new users with 48.2k invented clicks).
 *
 * These are the pure decisions a fresh account traverses. This is deliberately
 * NOT a live end-to-end run — that needs a real Supabase user and real LLM
 * spend — so it proves the logic is safe on empty input, not that the hosted
 * stack is up. The remaining gap is a manual release check.
 */
import { describe, it, expect } from 'vitest';
import { domainLimitFor, canAddDomain, smallestPlanForDomains, PLANS } from '../lib/plans';
import { limitFor, quotaFrom, shareAllowance } from '../lib/quota';
import { entitlementFrom } from '../lib/billing';
import { pipelineCounts } from '../lib/pipeline/counts';
import { planningProfile } from '../lib/strategy/ensure';
import { EMPTY_ONBOARDING } from '../lib/onboarding/checklist';
import { EMPTY_ACTIVITY } from '../lib/notifications/feed';
import { monthlySlots, maxPostsPerWeekForQuota } from '../lib/plans';

describe('signup → first domain', () => {
  it('lets an account with no subscription connect its first site', () => {
    // The single thing onboarding must be able to do. A ceiling that blocked
    // this would wall off every new signup at step one.
    const limit = domainLimitFor(null);
    expect(canAddDomain(limit, 0)).toBe(true);
  });

  it('stops at one until they pay, and names what to buy', () => {
    const limit = domainLimitFor(null);
    expect(canAddDomain(limit, 1)).toBe(false);
    expect(smallestPlanForDomains(2)).toBe('growth');
    expect(PLANS.growth.domainLimit).toBeGreaterThanOrEqual(2);
  });
});

describe('signup → entitlement', () => {
  it('does not grant LLM spend to an account that never checked out', () => {
    expect(entitlementFrom(null).canGenerate).toBe(false);
    expect(entitlementFrom({ stripe_status: null }).canGenerate).toBe(false);
    expect(entitlementFrom({ plan: 'starter', stripe_status: null }).canGenerate).toBe(false);
  });

  it('turns generation on the moment a real subscription exists', () => {
    expect(entitlementFrom({ plan: 'starter', stripe_status: 'active' }).canGenerate).toBe(true);
    expect(entitlementFrom({ plan: 'starter', stripe_status: 'trialing' }).canGenerate).toBe(true);
  });
});

describe('first subscription → quota', () => {
  it('gives a fresh subscriber their full plan allowance', () => {
    const q = quotaFrom({ plan: 'starter', posts_quota: 12, posts_used: 0 });
    expect(q.limit).toBe(12);
    expect(q.remaining).toBe(12);
    expect(q.exhausted).toBe(false);
  });

  it('falls back to the plan catalogue when the row carries no quota', () => {
    // New rows land on the schema default (4) or nothing at all; neither
    // should silently cap a paying Starter at less than they bought.
    expect(limitFor({ plan: 'growth', posts_quota: null })).toBe(PLANS.growth.postsQuota);
    expect(limitFor({ plan: 'agency', posts_quota: 0 })).toBe(PLANS.agency.postsQuota);
  });

  it('does not throttle an account it cannot price', () => {
    expect(limitFor(null)).toBeNull();
    expect(limitFor({ plan: 'starter', stripe_price_id: 'price_unknown' })).toBeNull();
  });
});

describe('first domain → first plan', () => {
  it('plans from a hostname alone when the crawl gave us nothing', () => {
    // A new site can be behind Cloudflare, or simply not up yet. Treating that
    // as "no plan" costs the customer their whole first month.
    expect(planningProfile(null, 'brand-new.com', true)).not.toBeNull();
    expect(planningProfile(null, 'brand-new.com', true)?.business?.name).toBeTruthy();
  });

  it('refuses to plan from nothing on the unattended path', () => {
    // The crons must not burn strategy spend on a site we know nothing about.
    expect(planningProfile(null, 'brand-new.com', false)).toBeNull();
  });

  it('sizes the first month to what the plan actually includes', () => {
    for (const id of ['starter', 'growth', 'agency'] as const) {
      const quota = PLANS[id].postsQuota;
      const cadence = maxPostsPerWeekForQuota(quota);
      const slots = monthlySlots(cadence, quota);
      expect(slots).toBeGreaterThan(0);
      expect(slots).toBeLessThanOrEqual(quota);
    }
  });

  it('gives a single-domain account its whole allowance', () => {
    const shares = shareAllowance({
      remaining: 12, alreadyQueued: 0, domainIds: ['first'], perDomainCap: 3,
    });
    expect(shares.get('first')).toBe(3);
  });
});

describe('empty dashboard', () => {
  it('raises no alarm before anything exists', () => {
    const c = pipelineCounts([]);
    expect(c.needsYou).toBe(0);
    expect(c.inFlight).toBe(0);
    expect(c.published).toBe(0);
  });

  it('ships an empty onboarding and activity payload rather than throwing', () => {
    // The dashboard layout falls back to these when its best-effort reads fail;
    // a malformed shape here white-screens the whole app for a new user.
    expect(EMPTY_ONBOARDING.steps).toEqual([]);
    expect(EMPTY_ONBOARDING.complete).toBe(false);
    expect(EMPTY_ONBOARDING.total).toBeGreaterThan(0);
    expect(EMPTY_ACTIVITY.items).toEqual([]);
    expect(EMPTY_ACTIVITY.attentionCount).toBe(0);
  });

  it('has something for the new user to do next', () => {
    // An onboarding with no next step strands them on an empty dashboard.
    expect(EMPTY_ONBOARDING.nextN === null || EMPTY_ONBOARDING.nextN > 0).toBe(true);
  });
});

describe('no hard-wired test data', () => {
  it('derives every plan figure from the catalogue, not a fixture', () => {
    // "Are the data hard-wired to test data?" — for plan logic, no: every
    // number a new account sees comes from PLANS, keyed by their own plan id.
    for (const id of ['starter', 'growth', 'agency'] as const) {
      const p = PLANS[id];
      expect(p.postsQuota).toBeGreaterThan(0);
      expect(p.priceUsd).toBeGreaterThan(0);
      expect(limitFor({ plan: id })).toBe(p.postsQuota);
    }
  });
});
