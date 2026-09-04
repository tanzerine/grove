/**
 * The operator planner's calendar arithmetic.
 *
 * Two things are actually load-bearing here and everything else is bookkeeping.
 *
 * The first is the ISO year boundary. A planner that files New Year's week
 * under the wrong year hides a week of work at the exact moment the operator
 * is reviewing the year, and it does it silently — the tasks are still in the
 * table, they just belong to a period nothing renders.
 *
 * The second is `todayKey`'s timezone. Vercel runs UTC and the operator is in
 * KST: for the first nine hours of every local day, a UTC "today" is
 * yesterday. That is the difference between a morning's tasks landing on the
 * right day and landing on one nobody looks at again.
 */
import { describe, it, expect } from 'vitest';
import {
  weekKeyOf, periodKeyFor, periodStart, periodEnd, shiftPeriod,
  parentPeriodKey, parentHorizon, isPeriodKey, periodLabel, relativeDayLabel,
  todayKey, addDays, rollup, columnProgress,
  type PlanNode,
} from '../lib/operator-plan';

describe('ISO week keys', () => {
  it('puts a week in the year that owns its Thursday, not its Monday', () => {
    // 2025-12-29 is a Monday whose Thursday is 2026-01-01, so the whole week
    // is 2026-W01 even though it starts in 2025.
    expect(weekKeyOf('2025-12-29')).toBe('2026-W01');
    expect(weekKeyOf('2026-01-01')).toBe('2026-W01');
    // And the mirror case: January days that belong to the previous year.
    expect(weekKeyOf('2027-01-01')).toBe('2026-W53');
    expect(weekKeyOf('2021-01-01')).toBe('2020-W53');
    expect(weekKeyOf('2024-12-30')).toBe('2025-W01');
  });

  it('pads the week number so keys sort as strings', () => {
    expect(weekKeyOf('2026-01-29')).toBe('2026-W05');
    expect(weekKeyOf('2026-09-04')).toBe('2026-W36');
  });

  it('round-trips a week key through its own Monday', () => {
    for (const day of ['2026-01-01', '2026-06-15', '2026-12-31', '2027-01-01']) {
      const key = weekKeyOf(day);
      expect(weekKeyOf(periodStart('week', key))).toBe(key);
      expect(weekKeyOf(periodEnd('week', key))).toBe(key);
    }
  });
});

describe('period spans', () => {
  it('derives each horizon from a day', () => {
    expect(periodKeyFor('month', '2026-09-04')).toBe('2026-09');
    expect(periodKeyFor('week', '2026-09-04')).toBe('2026-W36');
    expect(periodKeyFor('day', '2026-09-04')).toBe('2026-09-04');
  });

  it('bounds a week Monday to Sunday', () => {
    expect(periodStart('week', '2026-W36')).toBe('2026-08-31');
    expect(periodEnd('week', '2026-W36')).toBe('2026-09-06');
  });

  it('bounds a month without a leap-year table', () => {
    expect(periodEnd('month', '2026-02')).toBe('2026-02-28');
    expect(periodEnd('month', '2028-02')).toBe('2028-02-29');
    expect(periodEnd('month', '2026-12')).toBe('2026-12-31');
  });
});

describe('navigation', () => {
  it('steps months without the day-of-month skipping February', () => {
    expect(shiftPeriod('month', '2026-01', 1)).toBe('2026-02');
    expect(shiftPeriod('month', '2026-12', 1)).toBe('2027-01');
    expect(shiftPeriod('month', '2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('month', '2026-01', 14)).toBe('2027-03');
  });

  it('steps weeks across the year boundary', () => {
    expect(shiftPeriod('week', '2026-W53', 1)).toBe('2027-W01');
    expect(shiftPeriod('week', '2026-W01', -1)).toBe('2025-W52');
  });

  it('steps days across a month end', () => {
    expect(shiftPeriod('day', '2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftPeriod('day', '2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('the horizon above', () => {
  it('nests day inside week inside month', () => {
    expect(parentHorizon('day')).toBe('week');
    expect(parentHorizon('week')).toBe('month');
    expect(parentHorizon('month')).toBeNull();
  });

  it('gives a straddling week to the month holding its Thursday', () => {
    // 2026-W40 runs Mon Sep 28 → Sun Oct 4. Its Thursday is Oct 1, so its
    // goals live in October. Using the Monday would put the same week under
    // two months and hang its focus items off a goal never set for it.
    expect(periodStart('week', '2026-W40')).toBe('2026-09-28');
    expect(parentPeriodKey('week', '2026-W40')).toBe('2026-10');
    expect(parentPeriodKey('day', '2026-10-04')).toBe('2026-W40');
    expect(parentPeriodKey('month', '2026-09')).toBeNull();
  });
});

describe('key validation', () => {
  it('accepts the three real shapes', () => {
    expect(isPeriodKey('month', '2026-09')).toBe(true);
    expect(isPeriodKey('week', '2026-W36')).toBe(true);
    expect(isPeriodKey('day', '2026-09-04')).toBe(true);
  });

  it('rejects a key at the wrong horizon', () => {
    expect(isPeriodKey('day', '2026-09')).toBe(false);
    expect(isPeriodKey('month', '2026-09-04')).toBe(false);
    expect(isPeriodKey('week', '2026-09-04')).toBe(false);
  });

  // The regexes alone would pass both of these. A row written with either
  // would sit in the table addressed to a period no view ever asks for.
  it('rejects a date the calendar does not have', () => {
    expect(isPeriodKey('day', '2026-02-30')).toBe(false);
    expect(isPeriodKey('day', '2026-11-31')).toBe(false);
    expect(isPeriodKey('day', '2026-13-01')).toBe(false);
  });

  it('rejects week 53 of a 52-week year but allows it in a 53-week one', () => {
    expect(isPeriodKey('week', '2025-W53')).toBe(false);
    expect(isPeriodKey('week', '2026-W53')).toBe(true);
    expect(isPeriodKey('week', '2026-W00')).toBe(false);
  });
});

describe('todayKey', () => {
  it('reads the LOCAL date, not the UTC one', () => {
    // 00:30 on the 5th in KST is still 15:30 on the 4th in UTC. A planner that
    // reports the 4th here files the whole morning under yesterday.
    const kstEarlyMorning = new Date('2026-09-04T15:30:00Z'); // = 2026-09-05 00:30 KST
    const expected = `${kstEarlyMorning.getFullYear()}-`
      + `${String(kstEarlyMorning.getMonth() + 1).padStart(2, '0')}-`
      + `${String(kstEarlyMorning.getDate()).padStart(2, '0')}`;
    expect(todayKey(kstEarlyMorning)).toBe(expected);
    // Whatever the runner's zone, the answer must agree with the local getters
    // and must be a key the rest of the module accepts.
    expect(isPeriodKey('day', todayKey(kstEarlyMorning))).toBe(true);
  });
});

describe('labels', () => {
  it('names each period the way it would be said out loud', () => {
    expect(periodLabel('month', '2026-09')).toBe('September 2026');
    expect(periodLabel('day', '2026-09-04')).toBe('Friday, Sep 4');
  });

  it('drops the repeated month inside a week and keeps it across one', () => {
    expect(periodLabel('week', '2026-W36')).toBe('Week 36 · Aug 31–Sep 6');
    expect(periodLabel('week', '2026-W37')).toBe('Week 37 · Sep 7–13');
  });

  it('says how far a day is from today', () => {
    expect(relativeDayLabel('2026-09-04', '2026-09-04')).toBe('Today');
    expect(relativeDayLabel('2026-09-05', '2026-09-04')).toBe('Tomorrow');
    expect(relativeDayLabel('2026-09-03', '2026-09-04')).toBe('Yesterday');
    expect(relativeDayLabel('2026-09-10', '2026-09-04')).toBe('in 6 days');
    expect(relativeDayLabel('2026-08-30', '2026-09-04')).toBe('5 days ago');
  });
});

describe('roll-up', () => {
  const node = (id: string, parent: string | null, status: PlanNode['status'] = 'todo'): PlanNode =>
    ({ id, parent_id: parent, status });

  it('counts descendants two levels down, not just direct children', () => {
    // A month goal's real progress lives in the day tasks. Counting only the
    // week rows under it reports the goal untouched all month, then finished.
    const items = [
      node('goal', null),
      node('focus', 'goal'),
      node('taskA', 'focus', 'done'),
      node('taskB', 'focus'),
    ];
    const r = rollup(items);
    expect(r.get('focus')).toEqual({ done: 1, total: 2 });
    expect(r.get('goal')).toEqual({ done: 1, total: 3 });
  });

  it('excludes dropped work from both halves of the ratio', () => {
    const r = rollup([
      node('goal', null),
      node('a', 'goal', 'done'),
      node('b', 'goal', 'dropped'),
      node('c', 'goal'),
    ]);
    // 1 of 2, not 1 of 3: deciding not to do something should neither drag
    // the ratio down nor flatter it.
    expect(r.get('goal')).toEqual({ done: 1, total: 2 });
  });

  it('reports nothing for a leaf', () => {
    expect(rollup([node('solo', null, 'done')]).get('solo')).toEqual({ done: 0, total: 0 });
  });

  it('terminates on a cycle instead of hanging the page', () => {
    // Unreachable through the UI, but a hand-edited row could hold one, and an
    // unguarded walk would spin forever rather than show a wrong number.
    const r = rollup([node('a', 'b'), node('b', 'a')]);
    expect(r.get('a')).toBeDefined();
    expect(r.get('b')).toBeDefined();
  });
});

describe('columnProgress', () => {
  it('ignores dropped rows in a column header', () => {
    expect(columnProgress([
      { status: 'done' }, { status: 'todo' }, { status: 'dropped' }, { status: 'doing' },
    ])).toEqual({ done: 1, total: 3 });
    expect(columnProgress([])).toEqual({ done: 0, total: 0 });
  });
});
