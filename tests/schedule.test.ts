import { describe, it, expect } from 'vitest';
import { assignPublishDates, nextPublishSlot, publishableDays, slotsForRemainder } from '../lib/strategy/schedule';

const slots = (n: number): { id: string; publish_date?: string }[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));

describe('assignPublishDates', () => {
  it('gives every slot a date, never on a weekend', () => {
    const out = assignPublishDates(slots(17), '2026-06', 4);
    expect(out.every((s) => !!s.publish_date)).toBe(true);
    for (const s of out) {
      const wd = new Date(s.publish_date!).getUTCDay();
      expect(wd).not.toBe(0);
      expect(wd).not.toBe(6);
    }
  });

  it('spreads slots onto distinct days at 09:00 UTC', () => {
    const out = assignPublishDates(slots(8), '2026-02', 2);
    const days = new Set(out.map((s) => s.publish_date!.slice(0, 10)));
    expect(days.size).toBe(8);
    expect(out.every((s) => s.publish_date!.endsWith('T09:00:00.000Z'))).toBe(true);
  });

  it('respects an already-set publish_date', () => {
    const fixed = '2026-06-15T12:00:00.000Z';
    const out = assignPublishDates([{ id: 'a', publish_date: fixed }, { id: 'b' }], '2026-06', 4);
    expect(out[0].publish_date).toBe(fixed);
    expect(out[1].publish_date).toBeTruthy();
  });

  it('is deterministic', () => {
    const a = assignPublishDates(slots(10), '2026-07', 3);
    const b = assignPublishDates(slots(10), '2026-07', 3);
    expect(a.map((s) => s.publish_date)).toEqual(b.map((s) => s.publish_date));
  });
});

describe('nextPublishSlot', () => {
  it('returns a future top-of-hour ISO instant', () => {
    const iso = nextPublishSlot(7); // daily cadence → +24h
    const t = Date.parse(iso);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(Date.now());
    expect(iso.endsWith(':00:00.000Z')).toBe(true);
  });

  it('spaces by the cadence interval', () => {
    const daily = Date.parse(nextPublishSlot(7));
    const weekly = Date.parse(nextPublishSlot(1));
    expect(weekly).toBeGreaterThan(daily);
  });

  // Stress run: 168/0 = Infinity → Invalid Date → toISOString threw at the
  // FINAL persist, failing an already-approved draft.
  it('never throws on 0/null/garbage cadence — falls back to the default', () => {
    for (const v of [0, null, undefined, NaN, -3, 'x' as any]) {
      const iso = nextPublishSlot(v as any);
      expect(Number.isFinite(Date.parse(iso))).toBe(true);
    }
  });
});

describe('publishableDays', () => {
  it('uses the whole month when the month has not started', () => {
    // The monthly cron's normal case: built on (or before) the 1st.
    const days = publishableDays('2026-09', new Date('2026-08-20T12:00:00Z'));
    expect(days[0]).toBe(1);            // Tue 1 Sep 2026
    expect(days).toContain(30);
  });

  it('starts from today when the plan is built mid-month', () => {
    // Sun 26 Jul 2026, before 09:00 — the next weekday is Mon 27.
    const days = publishableDays('2026-07', new Date('2026-07-26T06:00:00Z'));
    expect(days).toEqual([27, 28, 29, 30, 31]);
  });

  it('skips today once its 09:00 slot has passed', () => {
    const days = publishableDays('2026-07', new Date('2026-07-27T10:00:00Z'));
    expect(days).toEqual([28, 29, 30, 31]);
  });

  it('runs into the next weekday rather than backwards on the last day', () => {
    // Fri 31 Jul 2026, 10:00 — nothing left this month; Mon 3 Aug is day 34.
    const days = publishableDays('2026-07', new Date('2026-07-31T10:00:00Z'));
    expect(days.length).toBe(1);
    const iso = new Date(Date.UTC(2026, 6, days[0], 9)).toISOString();
    expect(iso.slice(0, 10)).toBe('2026-08-03');
  });

  it('keeps a past month whole, so a historic rebuild holds its shape', () => {
    const days = publishableDays('2026-06', new Date('2026-07-26T06:00:00Z'));
    expect(days[0]).toBe(1);
  });
});

describe('slotsForRemainder', () => {
  it('pro-rates the cadence to the days the month has left', () => {
    // 5 weekdays left at 3/week → 3 slots, not a whole month's worth.
    expect(slotsForRemainder(3, '2026-07', new Date('2026-07-26T06:00:00Z'))).toBe(3);
    expect(slotsForRemainder(7, '2026-07', new Date('2026-07-29T06:00:00Z'))).toBe(3);
  });

  it('plans a full month when the month has not started', () => {
    expect(slotsForRemainder(3, '2026-09', new Date('2026-08-31T06:00:00Z'))).toBeGreaterThanOrEqual(12);
  });

  it('never plans more than one slot per publishable day', () => {
    const now = new Date('2026-07-29T06:00:00Z');       // Thu 30, Fri 31 left
    expect(slotsForRemainder(40, '2026-07', now)).toBeLessThanOrEqual(publishableDays('2026-07', now).length);
  });

  it('always leaves at least one slot, and tolerates a garbage cadence', () => {
    expect(slotsForRemainder(0, '2026-07', new Date('2026-07-31T06:00:00Z'))).toBe(1);
    expect(slotsForRemainder(NaN as any, '2026-08', new Date('2026-08-01T06:00:00Z'))).toBeGreaterThan(0);
  });
});

describe('assignPublishDates — mid-month', () => {
  it('never dates a slot before now', () => {
    const now = new Date('2026-07-26T06:00:00Z');
    const out = assignPublishDates(slots(4), '2026-07', 3, now);
    for (const s of out) expect(Date.parse(s.publish_date!)).toBeGreaterThan(now.getTime());
  });

  it('spreads the remaining weekdays instead of stacking them on one day', () => {
    const out = assignPublishDates(slots(5), '2026-07', 3, new Date('2026-07-26T06:00:00Z'));
    expect(new Set(out.map((s) => s.publish_date!.slice(0, 10))).size).toBe(5);
  });
});
