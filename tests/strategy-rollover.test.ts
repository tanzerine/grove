import { describe, it, expect } from 'vitest';
import {
  PLAN_LOOKAHEAD_DAYS,
  daysUntilNextMonth,
  monthKey,
  planToActivate,
  planningQueue,
  planningTargets,
  startOfMonthUTC,
  startOfNextMonthUTC,
  type StrategyRowLite,
} from '../lib/strategy/rollover';

const at = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

describe('month arithmetic', () => {
  it('anchors to the first of the month in UTC', () => {
    expect(monthKey(startOfMonthUTC(at(2026, 8, 17, 13)))).toBe('2026-08-01');
    expect(monthKey(startOfNextMonthUTC(at(2026, 8, 17, 13)))).toBe('2026-09-01');
  });

  it('rolls the year over in December', () => {
    expect(monthKey(startOfNextMonthUTC(at(2026, 12, 28)))).toBe('2027-01-01');
  });

  it('counts the days left in months of different lengths', () => {
    expect(daysUntilNextMonth(at(2026, 8, 31))).toBe(1);   // 31-day month
    expect(daysUntilNextMonth(at(2026, 9, 30))).toBe(1);   // 30-day month
    expect(daysUntilNextMonth(at(2026, 2, 28))).toBe(1);   // non-leap February
    expect(daysUntilNextMonth(at(2024, 2, 28))).toBe(2);   // leap February
  });
});

describe('planningTargets', () => {
  it('plans only the current month outside the lookahead window', () => {
    expect(planningTargets(at(2026, 8, 10))).toEqual([{ month: '2026-08-01', staged: false }]);
  });

  it('stages next month once inside the window', () => {
    // The whole fix: on 2026-07-28 the August plan is already buildable, so it
    // does not have to be built at 00:00 on the 1st with everyone else.
    expect(planningTargets(at(2026, 7, 28))).toEqual([
      { month: '2026-07-01', staged: false },
      { month: '2026-08-01', staged: true },
    ]);
  });

  it('always puts the live month first — a domain publishing nothing now outranks a head start', () => {
    const targets = planningTargets(at(2026, 7, 31, 23));
    expect(targets[0]).toEqual({ month: '2026-07-01', staged: false });
    expect(targets[1].staged).toBe(true);
  });

  it('opens the window exactly PLAN_LOOKAHEAD_DAYS out, and not a moment sooner', () => {
    const justInside = new Date(startOfNextMonthUTC(at(2026, 7, 1)).getTime() - PLAN_LOOKAHEAD_DAYS * 86_400_000);
    expect(planningTargets(justInside)).toHaveLength(2);
    expect(planningTargets(new Date(justInside.getTime() - 1))).toHaveLength(1);
  });

  it('buys enough runway to out-scale the platform at one plan per hourly tick', () => {
    // The bug was that N domains took N hours to plan at the boundary. The
    // window has to cover more domains than the schedule can serve articles for.
    expect(PLAN_LOOKAHEAD_DAYS * 24).toBeGreaterThan(120);
  });
});

describe('planToActivate', () => {
  const now = at(2026, 8, 1, 0); // the moment the month turns over

  const row = (o: Partial<StrategyRowLite> & { id: string }): StrategyRowLite => ({
    month: '2026-08-01', active: false, created_at: '2026-07-26T00:45:00Z', ...o,
  });

  it('promotes the staged plan and retires the month that just ended', () => {
    const rows = [
      row({ id: 'july', month: '2026-07-01', active: true, created_at: '2026-07-01T00:45:00Z' }),
      row({ id: 'august' }),
    ];
    expect(planToActivate(rows, now)).toEqual({ activateId: 'august', deactivateIds: ['july'] });
  });

  it('is a no-op once the rollover has happened — the tick runs hourly', () => {
    const rows = [row({ id: 'august', active: true })];
    expect(planToActivate(rows, now)).toEqual({ activateId: null, deactivateIds: [] });
  });

  it('leaves a plan a human built or revised this month alone', () => {
    // apply-revision inserts a new active row and deactivates the old one; the
    // superseded row must not be resurrected over the owner's revision.
    const rows = [
      row({ id: 'staged' }),
      row({ id: 'revised', active: true, created_at: '2026-08-03T10:00:00Z' }),
    ];
    expect(planToActivate(rows, at(2026, 8, 4))).toEqual({ activateId: null, deactivateIds: [] });
  });

  it('does nothing before the staged month arrives', () => {
    // On 2026-07-28 the August plan exists but July is still running — promoting
    // it early would abandon July's remaining slots.
    const rows = [
      row({ id: 'july', month: '2026-07-01', active: true }),
      row({ id: 'august' }),
    ];
    expect(planToActivate(rows, at(2026, 7, 28))).toEqual({ activateId: null, deactivateIds: [] });
  });

  it('never resurrects a superseded plan from an earlier month', () => {
    const rows = [
      row({ id: 'june-old', month: '2026-06-01', active: false }),
      row({ id: 'july', month: '2026-07-01', active: true }),
    ];
    expect(planToActivate(rows, now)).toEqual({ activateId: null, deactivateIds: [] });
  });

  it('clears every live plan, including a dormant domain stuck months back', () => {
    const rows = [
      row({ id: 'march', month: '2026-03-01', active: true }),
      row({ id: 'august' }),
    ];
    expect(planToActivate(rows, now)).toEqual({ activateId: 'august', deactivateIds: ['march'] });
  });

  it('picks the newest staged row so a retry after a partial failure is stable', () => {
    const rows = [
      row({ id: 'first', created_at: '2026-07-26T00:45:00Z' }),
      row({ id: 'second', created_at: '2026-07-27T00:45:00Z' }),
    ];
    expect(planToActivate(rows, now).activateId).toBe('second');
  });

  it('has nothing to do for a domain with no plans at all', () => {
    expect(planToActivate([], now)).toEqual({ activateId: null, deactivateIds: [] });
  });
});

describe('planningQueue', () => {
  const dom = (id: string, created_at: string, strategy_attempted_at: string | null = null) =>
    ({ id, created_at, strategy_attempted_at });

  it('puts never-attempted domains ahead of ones already tried', () => {
    const queue = planningQueue([
      dom('tried', '2026-06-02T00:00:00Z', '2026-08-01T09:45:00Z'),
      dom('fresh', '2026-07-26T00:00:00Z'),
    ]);
    expect(queue.map((d) => d.id)).toEqual(['fresh', 'tried']);
  });

  it('falls back to created_at while nothing has been attempted', () => {
    const queue = planningQueue([
      dom('newer', '2026-07-26T00:00:00Z'),
      dom('older', '2026-06-02T00:00:00Z'),
    ]);
    expect(queue.map((d) => d.id)).toEqual(['older', 'newer']);
  });

  it('rotates past a domain that cannot be planned', () => {
    // THE OUTAGE. `broken` is the oldest domain and fails every build. Under the
    // old fixed created_at order it was first on every tick forever, so `waiting`
    // — and every customer behind it — was never planned at all. Stamping the
    // attempt moves it to the back, so the next tick reaches the next domain.
    const broken = dom('broken', '2026-06-02T00:00:00Z');
    const waiting = dom('waiting', '2026-07-26T00:00:00Z');
    expect(planningQueue([broken, waiting])[0].id).toBe('broken');

    const afterTick = planningQueue([
      { ...broken, strategy_attempted_at: '2026-08-01T09:45:00Z' },
      waiting,
    ]);
    expect(afterTick[0].id).toBe('waiting');
  });

  it('comes back round to the broken domain once everyone has had a turn', () => {
    const queue = planningQueue([
      dom('broken', '2026-06-02T00:00:00Z', '2026-08-01T09:45:00Z'),
      dom('waiting', '2026-07-26T00:00:00Z', '2026-08-01T10:45:00Z'),
    ]);
    expect(queue.map((d) => d.id)).toEqual(['broken', 'waiting']);
  });

  it('does not mutate the array it was given', () => {
    const input = [
      dom('newer', '2026-07-26T00:00:00Z'),
      dom('older', '2026-06-02T00:00:00Z'),
    ];
    planningQueue(input);
    expect(input.map((d) => d.id)).toEqual(['newer', 'older']);
  });
});
