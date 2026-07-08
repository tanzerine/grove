import { describe, it, expect } from 'vitest';
import { assignPublishDates, nextPublishSlot } from '../lib/strategy/schedule';

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
