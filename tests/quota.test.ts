import { describe, it, expect } from 'vitest';
import {
  cycleExpired,
  exhaustedMessage,
  limitFor,
  nextCycleReset,
  quotaFrom,
} from '../lib/quota';
import { PLANS } from '../lib/plans';

const NOW = new Date('2026-07-25T12:00:00Z');
const THIS_CYCLE = '2026-08-01T00:00:00.000Z'; // still ahead of NOW

describe('limitFor', () => {
  it('prefers the stored quota so a comped or bespoke account is honoured', () => {
    expect(limitFor({ plan: 'starter', posts_quota: 500 })).toBe(500);
  });

  it('falls back to the plan catalogue when no quota is stored', () => {
    expect(limitFor({ plan: 'growth', posts_quota: null })).toBe(PLANS.growth.postsQuota);
    expect(limitFor({ plan: 'agency', posts_quota: 0 })).toBe(PLANS.agency.postsQuota);
  });

  it('does NOT enforce when the Stripe price id is not in the catalogue', () => {
    // Stripe and lib/plans have drifted, so posts_quota is whatever the column
    // happened to hold — often the schema default of 4. Throttling a customer
    // who may be paying for 150 over our own misconfiguration is unacceptable.
    expect(limitFor({ plan: 'starter', posts_quota: 4, stripe_price_id: 'price_unknown' })).toBeNull();
  });

  it('does not enforce an unknown plan with no stored quota', () => {
    expect(limitFor({ plan: 'legacy', posts_quota: null })).toBeNull();
    expect(limitFor(null)).toBeNull();
    expect(limitFor(undefined)).toBeNull();
  });
});

describe('cycleExpired / nextCycleReset', () => {
  it('is not expired before the boundary', () => {
    expect(cycleExpired(THIS_CYCLE, NOW)).toBe(false);
  });

  it('is expired at or past the boundary', () => {
    expect(cycleExpired('2026-07-01T00:00:00Z', NOW)).toBe(true);
    expect(cycleExpired(NOW.toISOString(), NOW)).toBe(true);
  });

  it('treats a missing or unparseable boundary as due', () => {
    expect(cycleExpired(null, NOW)).toBe(true);
    expect(cycleExpired(undefined, NOW)).toBe(true);
    expect(cycleExpired('not-a-date', NOW)).toBe(true);
  });

  it('rolls to the start of the next UTC month', () => {
    expect(nextCycleReset(NOW)).toBe('2026-08-01T00:00:00.000Z');
    // December must roll the year, not to month 13
    expect(nextCycleReset(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('quotaFrom', () => {
  it('reports remaining usage inside a live cycle', () => {
    const s = quotaFrom({ plan: 'starter', posts_quota: 12, posts_used: 5, cycle_resets_at: THIS_CYCLE }, NOW);
    expect(s).toMatchObject({ enforced: true, limit: 12, used: 5, remaining: 7, exhausted: false });
  });

  it('marks a fully-used cycle exhausted', () => {
    const s = quotaFrom({ plan: 'starter', posts_quota: 12, posts_used: 12, cycle_resets_at: THIS_CYCLE }, NOW);
    expect(s.remaining).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('never reports negative remaining if usage overshot', () => {
    const s = quotaFrom({ plan: 'starter', posts_quota: 12, posts_used: 99, cycle_resets_at: THIS_CYCLE }, NOW);
    expect(s.remaining).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('resets lazily once the cycle boundary has passed', () => {
    // Last month's counter must not carry over — this is what makes the reset
    // self-healing with no cron to fall behind.
    const s = quotaFrom(
      { plan: 'starter', posts_quota: 12, posts_used: 12, cycle_resets_at: '2026-07-01T00:00:00Z' },
      NOW,
    );
    expect(s.used).toBe(0);
    expect(s.remaining).toBe(12);
    expect(s.exhausted).toBe(false);
    expect(s.resetsAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('fails open for a subscription it cannot price', () => {
    const s = quotaFrom({ plan: 'starter', posts_quota: 4, stripe_price_id: 'price_unknown', posts_used: 99 }, NOW);
    expect(s.enforced).toBe(false);
    expect(s.exhausted).toBe(false);
    expect(s.remaining).toBe(Infinity);
  });

  it('fails open when there is no subscription row at all', () => {
    // The entitlement gate already blocks these; quota must not double-judge.
    const s = quotaFrom(null, NOW);
    expect(s.enforced).toBe(false);
    expect(s.exhausted).toBe(false);
  });

  it('closes the gap that made every tier identical', () => {
    // A Starter account used to be capped only by the shared rate limiter.
    const starter = quotaFrom(
      { plan: 'starter', posts_quota: PLANS.starter.postsQuota, posts_used: 12, cycle_resets_at: THIS_CYCLE },
      NOW,
    );
    const agency = quotaFrom(
      { plan: 'agency', posts_quota: PLANS.agency.postsQuota, posts_used: 12, cycle_resets_at: THIS_CYCLE },
      NOW,
    );
    expect(starter.exhausted).toBe(true);
    expect(agency.exhausted).toBe(false);
    expect(agency.remaining).toBe(PLANS.agency.postsQuota - 12);
  });
});

describe('exhaustedMessage', () => {
  it('names the limit and when it resets', () => {
    const s = quotaFrom({ plan: 'starter', posts_quota: 12, posts_used: 12, cycle_resets_at: THIS_CYCLE }, NOW);
    const msg = exhaustedMessage(s);
    expect(msg).toContain('12');
    expect(msg).toContain('August 1');
  });
});
