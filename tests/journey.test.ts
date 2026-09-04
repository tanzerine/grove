/**
 * The journey page's transcription guard.
 *
 * lib/journey.ts is a hand-copied `git log` summary — the app cannot read the
 * repo at runtime, so nothing else can catch a typo in it. The two sum checks
 * below are the whole point of this file: if a week or a phase is mistyped,
 * the page silently reports a smaller project than the one that happened, and
 * a retrospective that undercounts is worse than no retrospective.
 *
 * The rest covers the day arithmetic, because "day 56" is the claim the page
 * actually makes and an off-by-one there is invisible on the screen.
 */
import { describe, it, expect } from 'vitest';
import {
  WEEKS, PHASES, MILESTONES, TOTAL_COMMITS, START, END,
  dayOf, dayLabel, barPct, milestonesInWeek, weekLabel,
} from '../lib/journey';

const EXPECTED_COMMITS = 397;

describe('the transcription totals', () => {
  it('weeks sum to the repo commit count', () => {
    expect(TOTAL_COMMITS).toBe(EXPECTED_COMMITS);
  });

  it('phases account for every commit the weeks do', () => {
    const byPhase = PHASES.reduce((n, p) => n + p.commits, 0);
    expect(byPhase).toBe(EXPECTED_COMMITS);
  });

  it('runs week by week without a gap', () => {
    for (let i = 1; i < WEEKS.length; i++) {
      expect(dayOf(WEEKS[i].start) - dayOf(WEEKS[i - 1].start)).toBe(7);
    }
  });

  it('every phase ends after it starts, and they do not overlap', () => {
    for (const p of PHASES) expect(dayOf(p.to)).toBeGreaterThan(dayOf(p.from));
    for (let i = 1; i < PHASES.length; i++) {
      expect(dayOf(PHASES[i].from)).toBeGreaterThan(dayOf(PHASES[i - 1].to));
    }
  });
});

describe('day arithmetic', () => {
  it('counts the first day as day 1, not day 0', () => {
    expect(dayOf(START)).toBe(1);
  });

  it('gets the milestones the page names in prose', () => {
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

  it('labels a milestone that never happened as never, not day NaN', () => {
    const never = MILESTONES.find((m) => m.date === null)!;
    expect(never).toBeDefined();
    expect(dayLabel(never)).toBe('never');
  });
});

describe('bars', () => {
  it('gives the peak week the full height', () => {
    expect(barPct(Math.max(...WEEKS.map((w) => w.commits)))).toBe(100);
  });

  it('renders a silent week as nothing, not as a floor', () => {
    // The 0-commit week is the loudest bar on the chart precisely because it
    // is empty; a minimum height would hide it among the small weeks.
    expect(barPct(0)).toBe(0);
  });

  it('keeps a one-commit week visible', () => {
    expect(barPct(1)).toBeGreaterThanOrEqual(4);
  });
});

describe('milestone pinning', () => {
  it('puts a milestone under the week that contains it', () => {
    const pins = milestonesInWeek('2026-07-20'); // Jul 20-26
    expect(pins.map((p) => p.label)).toContain('First test that a new account can onboard at all');
  });

  it('does not pin it to the neighbouring week', () => {
    expect(milestonesInWeek('2026-07-13').map((p) => p.label))
      .not.toContain('First test that a new account can onboard at all');
  });

  it('pins every dated milestone to exactly one week', () => {
    const dated = MILESTONES.filter((m) => m.date);
    const pinned = WEEKS.flatMap((w) => milestonesInWeek(w.start));
    expect(pinned).toHaveLength(dated.length);
  });
});

describe('labels', () => {
  it('reads as a short calendar date', () => {
    expect(weekLabel('2026-06-08')).toBe('Jun 8');
    expect(weekLabel('2026-08-31')).toBe('Aug 31');
  });
});
