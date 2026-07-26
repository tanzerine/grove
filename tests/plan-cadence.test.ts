import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_IDS,
  WEEKS_PER_MONTH,
  maxPostsPerWeek,
  maxPostsPerWeekForQuota,
  monthlySlots,
} from '../lib/plans';
import { mergeRevision } from '../lib/strategy/plan-chat';

describe('maxPostsPerWeekForQuota', () => {
  it('caps each plan to a cadence its allowance can sustain', () => {
    expect(maxPostsPerWeek('starter')).toBe(3);   // 12/mo
    expect(maxPostsPerWeek('growth')).toBe(10);   // 40/mo
    expect(maxPostsPerWeek('agency')).toBe(35);   // 150/mo
  });

  it('rounds up, because the floor would under-deliver the plan', () => {
    // Starter's floor is 2/week = round(2 × 4.3) = 9 planned posts against an
    // allowance of 12 — a quarter of what the customer paid for, silently
    // withheld. Rounding up plans 13 and lets monthlySlots trim to exactly 12.
    expect(Math.floor(12 / WEEKS_PER_MONTH)).toBe(2);
    expect(maxPostsPerWeekForQuota(12)).toBe(3);
    expect(monthlySlots(2, 12)).toBe(9);
    expect(monthlySlots(maxPostsPerWeekForQuota(12), 12)).toBe(12);
  });

  it('never returns a cadence below one post a week', () => {
    expect(maxPostsPerWeekForQuota(1)).toBe(1);
    expect(maxPostsPerWeekForQuota(0)).toBe(1);
    expect(maxPostsPerWeekForQuota(-5)).toBe(1);
    expect(maxPostsPerWeekForQuota(NaN)).toBe(1);
  });

  it('lets every plan reach its full monthly allowance at max cadence', () => {
    // The property that matters: at the ceiling, nobody is short-changed.
    for (const id of PLAN_IDS) {
      const quota = PLANS[id].postsQuota;
      expect(monthlySlots(maxPostsPerWeek(id), quota)).toBe(quota);
    }
  });
});

describe('monthlySlots', () => {
  it('plans on cadence when it fits inside the allowance', () => {
    expect(monthlySlots(2, 40)).toBe(9);     // round(2 × 4.3)
    expect(monthlySlots(5, 40)).toBe(22);    // round(5 × 4.3)
  });

  it('trims the tail rather than planning posts the drain would refuse', () => {
    // The bug this closes: a Starter account on the default 3/week planned
    // round(3 × 4.3) = 13 slots against an allowance of 12, so one slot was
    // deferred as over-quota every single month.
    expect(Math.round(3 * WEEKS_PER_MONTH)).toBe(13);
    expect(monthlySlots(3, 12)).toBe(12);
  });

  it('keeps the floor of four slots when no allowance applies', () => {
    expect(monthlySlots(1, null)).toBe(4);
    expect(monthlySlots(1, undefined)).toBe(4);
  });

  it('leaves cadence alone for an account that is not quota-enforced', () => {
    // null limit comes from lib/quota's fail-open path (unpriceable plan).
    expect(monthlySlots(7, null)).toBe(30);
    expect(monthlySlots(7, 0)).toBe(30);
  });

  it('an over-plan cadence can never out-plan the allowance', () => {
    // Even a legacy row stored above the cap is trimmed at plan time.
    expect(monthlySlots(14, 12)).toBe(12);
    expect(monthlySlots(14, 40)).toBe(40);
  });
});

describe('mergeRevision — plan chat cannot buy a bigger month', () => {
  const slot = (id: string) => ({ id, pillar_id: 'p1', topic: `t-${id}`, publish_date: null });
  const base = (n: number): any => ({
    month: '2026-08', goals: [], kpis: [], pillars: [{ id: 'p1', name: 'P' }],
    publishing_plan: Array.from({ length: n }, (_, i) => slot(`s${i}`)),
  });

  it('trims a revision back to the plan allowance', () => {
    // The comment always claimed the quota was the spend guarantee, but the cap
    // was cadence-relative (up to 2x), so a chat message could plan 26 slots
    // against an allowance of 12.
    const merged = mergeRevision(base(3), base(26), { postsPerWeek: 3, monthlyQuota: 12 });
    expect(merged.publishing_plan!.length).toBe(12);
  });

  it('keeps the old cadence headroom when no allowance is enforced', () => {
    const merged = mergeRevision(base(3), base(26), { postsPerWeek: 3, monthlyQuota: null });
    expect(merged.publishing_plan!.length).toBe(26);
  });

  it('never trims a slot whose post already exists', () => {
    // A month planned before the cap can hold more slots than the allowance;
    // capping must not orphan drafted or published work.
    const locked = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12'];
    const merged = mergeRevision(base(13), base(13), {
      postsPerWeek: 3, monthlyQuota: 12, lockedSlotIds: locked,
    });
    expect(merged.publishing_plan!.length).toBe(13);
    for (const id of locked) {
      expect(merged.publishing_plan!.some((s: any) => s.id === id)).toBe(true);
    }
  });
});
