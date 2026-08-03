import { describe, it, expect } from 'vitest';
import {
  parseScheduleInput,
  relativeSchedule,
  schedulePresets,
  toLocalInputValue,
} from '../lib/publish-schedule';

// A Wednesday, 10:20 local time.
const wed = new Date(2026, 6, 22, 10, 20, 0);

describe('schedulePresets', () => {
  it('never offers a time in the past', () => {
    for (const base of [new Date(2026, 6, 22, 0, 5), wed, new Date(2026, 6, 22, 23, 45)]) {
      for (const p of schedulePresets(base)) {
        expect(new Date(p.iso).getTime()).toBeGreaterThan(base.getTime());
      }
    }
  });

  it('offers this evening only while it is still ahead', () => {
    expect(schedulePresets(wed).map((p) => p.key)).toContain('evening');
    expect(schedulePresets(new Date(2026, 6, 22, 20, 0)).map((p) => p.key)).not.toContain('evening');
  });

  it('snaps "in an hour" to the top of the hour', () => {
    const hour = schedulePresets(wed).find((p) => p.key === 'hour')!;
    const d = new Date(hour.iso);
    expect(d.getMinutes()).toBe(0);
    expect(d.getHours()).toBe(11);
  });

  it('puts the day presets at 9am local', () => {
    for (const key of ['tomorrow', 'monday'] as const) {
      const d = new Date(schedulePresets(wed).find((p) => p.key === key)!.iso);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it('resolves next Monday, and a week out when today is Monday', () => {
    const fromWed = new Date(schedulePresets(wed).find((p) => p.key === 'monday')!.iso);
    expect(fromWed.getDay()).toBe(1);
    expect(fromWed.getDate()).toBe(27);

    const mon = new Date(2026, 6, 27, 10, 0);
    const fromMon = new Date(schedulePresets(mon).find((p) => p.key === 'monday')!.iso);
    expect(fromMon.getDay()).toBe(1);
    expect(fromMon.getDate()).toBe(3); // the following Monday, in August
  });
});

describe('toLocalInputValue', () => {
  it('formats a datetime-local value in local time', () => {
    expect(toLocalInputValue(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });

  it('round-trips through parseScheduleInput', () => {
    const target = new Date(2027, 3, 9, 14, 30, 0, 0);
    const parsed = parseScheduleInput(toLocalInputValue(target), wed);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(new Date(parsed.iso).getTime()).toBe(target.getTime());
  });
});

describe('parseScheduleInput', () => {
  it('rejects blank and unparseable input', () => {
    expect(parseScheduleInput('', wed)).toEqual({ ok: false, error: 'Pick a date and time.' });
    expect(parseScheduleInput('someday', wed).ok).toBe(false);
  });

  it('rejects a time in the past', () => {
    const past = parseScheduleInput('2026-07-21T10:00', wed);
    expect(past).toEqual({ ok: false, error: 'Pick a time in the future.' });
  });

  it('allows a minute of slack so a just-offered preset still validates', () => {
    const almostNow = new Date(wed.getTime() - 30_000);
    expect(parseScheduleInput(almostNow.toISOString(), wed).ok).toBe(true);
  });

  it('returns a UTC instant', () => {
    const parsed = parseScheduleInput('2026-08-01T08:00', wed);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.iso.endsWith('Z')).toBe(true);
  });
});

describe('relativeSchedule', () => {
  const at = (mins: number) => new Date(wed.getTime() + mins * 60_000).toISOString();

  it('describes the distance coarsely', () => {
    expect(relativeSchedule(at(25), wed)).toBe('in 25 min');
    expect(relativeSchedule(at(60), wed)).toBe('in 1 hour');
    expect(relativeSchedule(at(300), wed)).toBe('in 5 hours');
    expect(relativeSchedule(at(60 * 24 * 3), wed)).toBe('in 3 days');
    expect(relativeSchedule(at(60 * 24 * 21), wed)).toBe('in 3 weeks');
  });

  it('says due now for a past or imminent instant', () => {
    expect(relativeSchedule(at(-10), wed)).toBe('due now');
  });

  // The cron publishes `scheduled` and nothing else. A draft held in review
  // keeps its plan slot's date forever, so counting down to it — or announcing
  // it "due now" — promises a publish that will never happen.
  it('reports what a gated draft is actually waiting on, not the clock', () => {
    expect(relativeSchedule(at(-10), wed, { willPublish: false })).toBe('needs approval');
    expect(relativeSchedule(at(300), wed, { willPublish: false })).toBe('needs approval');
    expect(relativeSchedule(at(300), wed, { willPublish: true })).toBe('in 5 hours');
  });

  it('is empty for a missing or invalid instant', () => {
    expect(relativeSchedule(null, wed)).toBe('');
    expect(relativeSchedule('nope', wed)).toBe('');
  });
});
