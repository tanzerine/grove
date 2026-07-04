import { describe, it, expect } from 'vitest';
import { entitlementFrom } from '../lib/billing';

describe('entitlementFrom', () => {
  it('grants generation to an active Stripe subscription', () => {
    const e = entitlementFrom({ plan: 'starter', stripe_status: 'active' });
    expect(e.canGenerate).toBe(true);
    expect(e.reason).toBe('paying');
  });

  it('grants generation to a Stripe card trial (checked out, trialing)', () => {
    const e = entitlementFrom({ plan: 'growth', stripe_status: 'trialing' });
    expect(e.canGenerate).toBe(true);
    expect(e.reason).toBe('card_trial');
  });

  it('is case-insensitive on status', () => {
    expect(entitlementFrom({ stripe_status: 'Active' }).canGenerate).toBe(true);
  });

  it('denies a signup that never checked out, even inside the built-in trial window', () => {
    const e = entitlementFrom({
      plan: 'starter',
      stripe_status: null,
      trial_ends_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
    expect(e.canGenerate).toBe(false);
    expect(e.reason).toBe('no_subscription');
  });

  it('denies lapsed / failed payment states', () => {
    for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
      const e = entitlementFrom({ stripe_status: status });
      expect(e.canGenerate).toBe(false);
      expect(e.reason).toBe('not_paying');
    }
  });

  it('denies a missing subscription row', () => {
    expect(entitlementFrom(null)).toEqual({ canGenerate: false, reason: 'no_subscription' });
    expect(entitlementFrom(undefined)).toEqual({ canGenerate: false, reason: 'no_subscription' });
  });
});
