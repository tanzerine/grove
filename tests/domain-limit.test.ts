/**
 * The domain allowance each plan sells, actually enforced.
 *
 * For a long time "1 domain" / "Up to 3 domains" / "Unlimited domains" existed
 * only as marketing copy in PLANS[].features — no field, no check, and a single
 * unconditional insert in POST /api/domains. A $29 Starter account could run as
 * many sites as it liked, which is how the owner's own Starter account came to
 * be running two, and why Growth had no capability Starter didn't already give
 * away.
 */
import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_IDS,
  canAddDomain,
  describeDomainLimit,
  domainLimitFor,
  smallestPlanForDomains,
} from '../lib/plans';

describe('canAddDomain', () => {
  it('allows up to the ceiling and no further', () => {
    expect(canAddDomain(1, 0)).toBe(true);
    expect(canAddDomain(1, 1)).toBe(false);
    expect(canAddDomain(3, 2)).toBe(true);
    expect(canAddDomain(3, 3)).toBe(false);
  });

  it('treats a null ceiling as unlimited', () => {
    expect(canAddDomain(null, 0)).toBe(true);
    expect(canAddDomain(null, 999)).toBe(true);
  });

  it('grandfathers an account that is already over its ceiling', () => {
    // The owner's Starter account holds 2 domains from before enforcement.
    // It must be blocked from adding a THIRD, never told to give one up —
    // this function's only answer is about the next domain, not the existing.
    expect(canAddDomain(1, 2)).toBe(false);
    expect(canAddDomain(1, 5)).toBe(false);
  });
});

describe('domainLimitFor', () => {
  it('gives each plan the ceiling its features promise', () => {
    expect(domainLimitFor({ plan: 'starter', stripe_status: 'active' })).toBe(1);
    expect(domainLimitFor({ plan: 'growth', stripe_status: 'active' })).toBe(3);
    expect(domainLimitFor({ plan: 'agency', stripe_status: 'active' })).toBeNull();
  });

  it('honours the ceiling through a trial and a payment retry', () => {
    expect(domainLimitFor({ plan: 'growth', stripe_status: 'trialing' })).toBe(3);
    // past_due is a card Stripe is still retrying — not a reason to demote.
    expect(domainLimitFor({ plan: 'growth', stripe_status: 'past_due' })).toBe(3);
  });

  it('drops a lapsed subscription to the entry ceiling', () => {
    expect(domainLimitFor({ plan: 'agency', stripe_status: 'canceled' })).toBe(1);
    expect(domainLimitFor({ plan: 'growth', stripe_status: null })).toBe(1);
  });

  it('gives an account with no subscription the entry ceiling, not free rein', () => {
    expect(domainLimitFor(null)).toBe(1);
    expect(domainLimitFor(undefined)).toBe(1);
  });

  it('declines to enforce when Stripe and the catalogue have drifted', () => {
    // An unrecognised price id means we cannot price this account. Throttling
    // someone who may be paying for Agency over our own misconfiguration is
    // worse than briefly over-delivering — same call lib/quota makes.
    expect(domainLimitFor({
      plan: 'starter',
      stripe_status: 'active',
      stripe_price_id: 'price_not_in_our_catalogue',
    })).toBeNull();
  });

  it('falls back to the entry ceiling for an unrecognised plan name', () => {
    expect(domainLimitFor({ plan: 'enterprise-bespoke', stripe_status: 'active' })).toBe(1);
  });
});

describe('plan catalogue integrity', () => {
  it('gives every plan an explicit domain ceiling', () => {
    for (const id of PLAN_IDS) {
      const limit = PLANS[id].domainLimit;
      expect(limit === null || (Number.isInteger(limit) && limit > 0)).toBe(true);
    }
  });

  it('never sells a smaller ceiling at a higher price', () => {
    const byPrice = PLAN_IDS.slice().sort((a, b) => PLANS[a].priceUsd - PLANS[b].priceUsd);
    let previous = 0;
    for (const id of byPrice) {
      const limit = PLANS[id].domainLimit;
      if (limit === null) { previous = Infinity; continue; }
      expect(limit).toBeGreaterThanOrEqual(previous);
      previous = limit;
    }
  });

  it('keeps the enforced ceiling in step with the copy the customer reads', () => {
    // The features string is the promise; domainLimit is the delivery. If these
    // drift, someone is being lied to in one direction or the other.
    expect(PLANS.starter.features.join(' ')).toMatch(/\b1 domain\b/);
    expect(PLANS.growth.features.join(' ')).toMatch(/\b3 domains\b/);
    expect(PLANS.agency.features.join(' ')).toMatch(/[Uu]nlimited domains/);
  });
});

describe('upsell targeting', () => {
  it('names the cheapest plan that fits the domain the user is adding', () => {
    expect(smallestPlanForDomains(1)).toBe('starter');
    expect(smallestPlanForDomains(2)).toBe('growth');
    expect(smallestPlanForDomains(3)).toBe('growth');
    expect(smallestPlanForDomains(4)).toBe('agency');
    expect(smallestPlanForDomains(500)).toBe('agency');
  });
});

describe('describeDomainLimit', () => {
  it('reads naturally in the error the customer sees', () => {
    expect(describeDomainLimit(1)).toBe('1 domain');
    expect(describeDomainLimit(3)).toBe('3 domains');
    expect(describeDomainLimit(null)).toBe('unlimited domains');
  });
});
