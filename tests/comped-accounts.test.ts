/**
 * Comped accounts: internal, dogfooding, bespoke deals — not metered.
 *
 * The motivating case: grove's own domain runs on the founder's subscription,
 * which also owns the real customer site. Both shared one Starter allowance, so
 * dogfooding directly starved the site that has actual readers.
 *
 * The obvious workaround — raise posts_quota by hand — does not survive. The
 * Stripe webhook rewrites posts_quota from the plan catalogue on EVERY
 * subscription event, so a hand-edited quota silently reverts at the next
 * renewal and nobody notices until posts stop appearing.
 *
 * Hence a flag Stripe never writes, checked BEFORE anything Stripe owns. The
 * tests below pin that ordering, because it is the entire reason this works.
 */
import { describe, it, expect } from 'vitest';
import { limitFor, quotaFrom } from '../lib/quota';
import { domainLimitFor, canAddDomain } from '../lib/plans';
import { entitlementFrom } from '../lib/billing';

// A cycle that hasn't rolled over yet. Required: quotaFrom treats an unset
// boundary as due and zeroes `used`, which would make "exhausted" unreachable.
const NOW = new Date('2026-07-27T10:00:00Z');
const THIS_CYCLE = '2026-08-01T00:00:00Z';

describe('comped: post quota', () => {
  it('is not metered', () => {
    expect(limitFor({ plan: 'starter', posts_quota: 12, comped: true })).toBeNull();
  });

  it('survives the webhook rewriting posts_quota on renewal', () => {
    // This is the failure the flag exists to prevent: the webhook resets
    // posts_quota to the plan default on every subscription event. Because
    // `comped` is read first, that rewrite is simply irrelevant.
    const afterWebhookRewrite = {
      plan: 'starter', posts_quota: 12, posts_used: 12,
      cycle_resets_at: THIS_CYCLE, comped: true,
    };
    expect(limitFor(afterWebhookRewrite)).toBeNull();

    const state = quotaFrom(afterWebhookRewrite, NOW);
    expect(state.enforced).toBe(false);
    expect(state.remaining).toBe(Infinity);
    expect(state.exhausted).toBe(false);
  });

  it('frees an account that had already hit its ceiling', () => {
    // Exactly the owner's live state: 12/12, cycle not yet rolled over.
    const exhausted = { plan: 'starter', posts_quota: 12, posts_used: 12, cycle_resets_at: THIS_CYCLE };
    expect(quotaFrom(exhausted, NOW).exhausted).toBe(true);
    expect(quotaFrom({ ...exhausted, comped: true }, NOW).exhausted).toBe(false);
  });

  it('leaves every other account metered exactly as before', () => {
    expect(limitFor({ plan: 'starter', posts_quota: 12, comped: false })).toBe(12);
    expect(limitFor({ plan: 'starter', posts_quota: 12 })).toBe(12);
    expect(quotaFrom(
      { plan: 'starter', posts_quota: 12, posts_used: 12, cycle_resets_at: THIS_CYCLE }, NOW,
    ).exhausted).toBe(true);
  });
});

describe('comped: domain ceiling', () => {
  it('lifts the ceiling entirely', () => {
    expect(domainLimitFor({ plan: 'starter', stripe_status: 'active', comped: true })).toBeNull();
    expect(canAddDomain(domainLimitFor({ plan: 'starter', comped: true }), 99)).toBe(true);
  });

  it('is not re-imposed by a lapsed or mismatched Stripe row', () => {
    // Checked before plan and status, so a cancelled subscription can't quietly
    // demote a comped account back to the entry ceiling.
    expect(domainLimitFor({ plan: 'starter', stripe_status: 'canceled', comped: true })).toBeNull();
    expect(domainLimitFor({ plan: 'starter', stripe_price_id: 'price_unknown', comped: true })).toBeNull();
  });

  it('leaves normal accounts at their plan ceiling', () => {
    expect(domainLimitFor({ plan: 'starter', stripe_status: 'active', comped: false })).toBe(1);
    expect(domainLimitFor({ plan: 'growth', stripe_status: 'active' })).toBe(3);
  });
});

describe('comped: entitlement', () => {
  it('keeps generating even with no live subscription', () => {
    // An internal account going dark the day a card expires would look like
    // the product itself breaking.
    expect(entitlementFrom({ comped: true }).canGenerate).toBe(true);
    expect(entitlementFrom({ stripe_status: 'canceled', comped: true }).canGenerate).toBe(true);
    expect(entitlementFrom({ stripe_status: null, comped: true }).reason).toBe('comped');
  });

  it('still refuses everyone else', () => {
    expect(entitlementFrom({ stripe_status: 'canceled', comped: false }).canGenerate).toBe(false);
    expect(entitlementFrom({ stripe_status: null }).canGenerate).toBe(false);
    expect(entitlementFrom(null).canGenerate).toBe(false);
  });
});

describe('comped: absent column behaves as today', () => {
  it('treats a missing flag as not comped', () => {
    // Before migration 0030 lands, `comped` reads as undefined. Every reader
    // must fall through to existing behaviour rather than exempting anyone —
    // the star-selects exist so this is the worst case, not a failed query.
    const row = {
      plan: 'starter', posts_quota: 12, posts_used: 12,
      cycle_resets_at: THIS_CYCLE, stripe_status: 'active',
    };
    expect(limitFor(row)).toBe(12);
    expect(quotaFrom(row, NOW).exhausted).toBe(true);
    expect(domainLimitFor(row)).toBe(1);
    expect(entitlementFrom(row).canGenerate).toBe(true);
    expect(entitlementFrom(row).reason).toBe('paying');
  });

  it('never exempts an account on a null or undefined flag', () => {
    for (const comped of [null, undefined, false]) {
      expect(limitFor({ plan: 'starter', posts_quota: 12, comped })).toBe(12);
      expect(domainLimitFor({ plan: 'starter', stripe_status: 'active', comped })).toBe(1);
    }
  });
});
