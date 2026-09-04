/**
 * The journey page's transcription guards.
 *
 * Both journey libs are hand-copied `git log` summaries — the app cannot read
 * the repo at runtime, so nothing else can catch a typo in them. The sum check
 * below is the whole point: retyping one day's count fails until the declared
 * total is updated on purpose. A retrospective that undercounts the work is
 * worse than no retrospective.
 *
 * The rest covers the day arithmetic, because "day 56" is the claim the page
 * actually makes and an off-by-one there is invisible on the screen.
 */
import { describe, it, expect } from 'vitest';
import { BUILT, START, END, dayOf } from '../lib/journey';
import {
  RECORDED_COMMITS, TRANSCRIBED_TOTAL, FIRST_DAY, LAST_DAY,
  allDays, dayNumber, isWeekend, longestSilence, monthLabel, weekdayOf,
} from '../lib/journey-days';

describe('the transcription', () => {
  it('sums to the total it declares', () => {
    expect(RECORDED_COMMITS).toBe(TRANSCRIBED_TOTAL);
  });

  it('starts and ends where the build ledger says the project did', () => {
    expect(FIRST_DAY).toBe(START);
    expect(LAST_DAY).toBe(END);
  });

  it('never records a day twice', () => {
    const dates = allDays().map((d) => d.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('gives every calendar day a column, quiet ones included', () => {
    const days = allDays();
    expect(days).toHaveLength(dayOf(END)); // 96
    // Consecutive, no holes — a skipped date would silently shorten the gaps.
    for (let i = 1; i < days.length; i++) {
      expect(dayOf(days[i].date) - dayOf(days[i - 1].date)).toBe(1);
    }
  });

  it('keeps the quiet days actually quiet', () => {
    const days = allDays();
    const quiet = days.filter((d) => d.commits === 0 && d.did.length === 0 && !d.note);
    expect(quiet.length).toBeGreaterThan(20);
  });
});

describe('day arithmetic', () => {
  it('counts the first day as day 1, not day 0', () => {
    expect(dayOf(START)).toBe(1);
  });

  it('gets the intervals the page is built to show', () => {
    // These three, in this order, ARE the finding — billing before the meter,
    // the meter before the proof anyone could sign up.
    expect(dayOf('2026-06-28')).toBe(28); // Stripe live
    expect(dayOf('2026-07-25')).toBe(55); // quota enforcement
    expect(dayOf('2026-07-26')).toBe(56); // first empty-database onboarding test
    expect(dayOf(END)).toBe(96);
  });

  it('crosses month boundaries of different lengths', () => {
    expect(dayOf('2026-07-01')).toBe(31); // June has 30
    expect(dayOf('2026-08-01')).toBe(62); // July has 31
  });
});

describe('calendar labels', () => {
  it('reads weekdays in UTC, not the runner’s zone', () => {
    // 2026-06-01 is a Monday. A local-time parse in KST would still say Monday,
    // but one in UTC-5 would say Sunday and shift the whole strip.
    expect(weekdayOf('2026-06-01')).toBe('Mon');
    expect(weekdayOf('2026-09-04')).toBe('Fri');
  });

  it('knows a weekend from a working day', () => {
    expect(isWeekend('2026-06-06')).toBe(true);  // Saturday
    expect(isWeekend('2026-06-07')).toBe(true);  // Sunday
    expect(isWeekend('2026-06-08')).toBe(false); // Monday
  });

  it('labels months and day numbers off the string, not a Date', () => {
    expect(monthLabel('2026-08-31')).toBe('Aug');
    expect(dayNumber('2026-08-31')).toBe(31);
    expect(dayNumber('2026-08-01')).toBe(1);
  });
});

describe('the silences', () => {
  it('finds the longest run of days with nothing at all', () => {
    const s = longestSilence(allDays())!;
    expect(s).not.toBeNull();
    // Aug 16-25: the ten days between the last Reddit commit and the morning
    // the 30 leads were researched. This is the loudest thing on the page.
    expect(s.from).toBe('2026-08-16');
    expect(s.to).toBe('2026-08-25');
    expect(s.length).toBe(10);
  });

  it('does not count a day that carries only a note as silent', () => {
    // Aug 9 has no commit but does have "LAUNCH52 created. Never redeemed."
    const s = longestSilence(allDays().filter((d) => d.date >= '2026-08-06' && d.date <= '2026-08-10'))!;
    expect(s.length).toBeLessThan(4);
  });
});

describe('the build ledger', () => {
  it('states a figure for every label', () => {
    expect(BUILT.length).toBeGreaterThan(3);
    for (const b of BUILT) expect(b.value).not.toBe('');
  });
});
