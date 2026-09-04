/**
 * The build ledger — PURE, no I/O.
 *
 * The counts Vercel cannot derive, because it has no git checkout: the repo
 * totals are transcribed rather than read. The day-by-day record lives in
 * lib/journey-days.ts; this file is only the headline figures and the day
 * arithmetic both sides share.
 *
 * Day numbering: 2026-06-01 is day 1, so `dayOf` is what turns "Jul 26" into
 * "day 56". The interval that matters is always days-from-start — a calendar
 * date hides how long something took, and how long things took is the finding.
 *
 * NOTE the two totals in this project are counted differently and both are
 * right: 397 here includes merge commits (it is the repo's length), while
 * lib/journey-days.ts counts 325 with `--no-merges`, because a merge commit is
 * the same work counted twice and a per-day column wants the work.
 */

export const START = '2026-06-01';
export const END = '2026-09-04';

const DAY_MS = 86_400_000;

/** Days since day 1 (2026-06-01 = 1). Civil dates parsed as UTC midnight. */
export function dayOf(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  const t0 = Date.parse(`${START}T00:00:00Z`);
  return Math.round((t - t0) / DAY_MS) + 1;
}

/** Static counts from the repo — the left-hand column of the two ledgers. */
export const BUILT = [
  { label: 'Commits', value: '397' },
  { label: 'Pull requests', value: '264' },
  { label: 'Lines of TypeScript', value: '~52,900' },
  { label: 'Test files', value: '115' },
  { label: 'Days', value: String(dayOf(END)) },
];
