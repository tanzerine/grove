/**
 * Planning must never commit more posts than the plan can pay for.
 *
 * The allowance is per SUBSCRIPTION; planning runs per DOMAIN. Gating that on a
 * bare "is this owner exhausted?" boolean produced two compounding failures on
 * a live account, and these tests pin both.
 */
import { describe, it, expect } from 'vitest';
import { shareAllowance } from '../lib/quota';

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe('shareAllowance', () => {
  it('divides one allowance across the owner’s domains', () => {
    const shares = shareAllowance({
      remaining: 12, alreadyQueued: 0, domainIds: ['a', 'b'], perDomainCap: 10,
    });
    expect(shares.get('a')).toBe(6);
    expect(shares.get('b')).toBe(6);
  });

  it('never plans more than the allowance in total', () => {
    for (const remaining of [0, 1, 5, 12, 13, 40, 150]) {
      const shares = shareAllowance({
        remaining, alreadyQueued: 0, domainIds: ['a', 'b', 'c'], perDomainCap: 3,
      });
      expect(total(shares)).toBeLessThanOrEqual(remaining);
    }
  });

  it('subtracts work already planned but not yet generated', () => {
    // `remaining` only falls when a post is GENERATED. Without this
    // subtraction each tick re-plans against an allowance the last tick
    // already committed, and the queue grows without bound.
    const shares = shareAllowance({
      remaining: 12, alreadyQueued: 8, domainIds: ['a', 'b'], perDomainCap: 10,
    });
    expect(total(shares)).toBe(4);
  });

  it('plans nothing once the queue already covers the allowance', () => {
    const shares = shareAllowance({
      remaining: 12, alreadyQueued: 12, domainIds: ['a', 'b'], perDomainCap: 3,
    });
    expect(total(shares)).toBe(0);
  });

  it('plans nothing when the queue has overshot the allowance', () => {
    const shares = shareAllowance({
      remaining: 4, alreadyQueued: 30, domainIds: ['a'], perDomainCap: 3,
    });
    expect(shares.get('a')).toBe(0);
  });

  it('honours the per-tick cap so one tick cannot plan a whole month', () => {
    const shares = shareAllowance({
      remaining: 150, alreadyQueued: 0, domainIds: ['a', 'b'], perDomainCap: 3,
    });
    expect(shares.get('a')).toBe(3);
    expect(shares.get('b')).toBe(3);
  });

  it('spreads an indivisible remainder deterministically, one each', () => {
    const shares = shareAllowance({
      remaining: 7, alreadyQueued: 0, domainIds: ['a', 'b', 'c'], perDomainCap: 10,
    });
    expect(shares.get('a')).toBe(3);
    expect(shares.get('b')).toBe(2);
    expect(shares.get('c')).toBe(2);
    expect(total(shares)).toBe(7);
  });

  it('gives a scarce allowance to as many domains as it covers', () => {
    const shares = shareAllowance({
      remaining: 2, alreadyQueued: 0, domainIds: ['a', 'b', 'c'], perDomainCap: 3,
    });
    expect(total(shares)).toBe(2);
    expect(shares.get('c')).toBe(0);
  });

  it('leaves an unenforced account exactly as it behaves today', () => {
    const shares = shareAllowance({
      remaining: Infinity, alreadyQueued: 99, domainIds: ['a', 'b'], perDomainCap: 3,
    });
    expect(shares.get('a')).toBe(3);
    expect(shares.get('b')).toBe(3);
  });

  it('handles an owner with no domains, and a zero cap', () => {
    expect(shareAllowance({ remaining: 12, alreadyQueued: 0, domainIds: [], perDomainCap: 3 }).size).toBe(0);
    expect(shareAllowance({ remaining: 12, alreadyQueued: 0, domainIds: ['a'], perDomainCap: 0 }).size).toBe(0);
  });

  it('reproduces the production case that caused the undrainable backlog', () => {
    // Starter (12/month), two domains at 4 and 3 posts/week — ~30 slots
    // between them. Old behaviour planned all 30; posts_used pinned at 12/12
    // with 8 posts stuck `queued` that could never be generated.
    const shares = shareAllowance({
      remaining: 12, alreadyQueued: 0,
      domainIds: ['oveners', 'trygroveai'], perDomainCap: 3,
    });
    expect(total(shares)).toBeLessThanOrEqual(12);

    // And once the cycle is spent, planning stops dead rather than queueing
    // work the next tick will refuse.
    const exhausted = shareAllowance({
      remaining: 0, alreadyQueued: 8,
      domainIds: ['oveners', 'trygroveai'], perDomainCap: 3,
    });
    expect(total(exhausted)).toBe(0);
  });
});
