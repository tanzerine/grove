/**
 * The build record for grove's first 96 days — PURE, no I/O.
 *
 * This is the half of the story the database cannot tell. Vercel has no git
 * checkout and the app has no repo access, so the commit history is transcribed
 * here as data rather than read at runtime. It is a FIXED record of what was
 * built between 2026-06-01 and 2026-09-04; the other half — what any of it
 * reached — is read live in lib/journey-store.ts, because that half can still
 * change and a retrospective that freezes it is just a screenshot.
 *
 * Every number below came from `git log` on the repo at 5fb3bd2 (397 commits).
 * WEEKS sums to that total, and a test asserts it, so a bad transcription
 * fails the build instead of quietly reporting a smaller project.
 *
 * Day numbering: 2026-06-01 is day 1, so `dayOf` is what turns "Jul 26" into
 * "day 56" — the interval that matters is always days-from-start, never the
 * calendar date, because the calendar date hides how long something took.
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

/* ── weekly commit volume ──────────────────────────────────────────────── */

export type Week = {
  /** Monday of the week, YYYY-MM-DD. */
  start: string;
  commits: number;
  /** Index into PHASES — colours the bar and ties it to the narrative. */
  phase: number;
};

export const WEEKS: Week[] = [
  { start: '2026-06-01', commits: 57, phase: 0 },
  { start: '2026-06-08', commits: 68, phase: 1 },
  { start: '2026-06-15', commits: 21, phase: 1 },
  { start: '2026-06-22', commits: 34, phase: 2 },
  { start: '2026-06-29', commits: 26, phase: 3 },
  { start: '2026-07-06', commits: 27, phase: 3 },
  { start: '2026-07-13', commits: 44, phase: 3 },
  { start: '2026-07-20', commits: 49, phase: 4 },
  { start: '2026-07-27', commits: 46, phase: 4 },
  { start: '2026-08-03', commits: 9, phase: 4 },
  { start: '2026-08-10', commits: 4, phase: 5 },
  { start: '2026-08-17', commits: 0, phase: 5 },
  { start: '2026-08-24', commits: 6, phase: 5 },
  { start: '2026-08-31', commits: 6, phase: 6 },
];

export const TOTAL_COMMITS = WEEKS.reduce((n, w) => n + w.commits, 0);
export const PEAK_COMMITS = Math.max(...WEEKS.map((w) => w.commits));

/* ── phases ────────────────────────────────────────────────────────────── */

export type Phase = {
  title: string;
  from: string;
  to: string;
  commits: number;
  /** One line. What this stretch was, said plainly. */
  gist: string;
  /** What shipped. */
  built: string[];
  /** What the database said while it shipped. The counterweight. */
  reality: string;
};

export const PHASES: Phase[] = [
  {
    title: 'The engine',
    from: '2026-06-01', to: '2026-06-07', commits: 57,
    gist: 'The pipeline that is still the product got built in seven days.',
    built: [
      '3-method domain verification (DNS / meta / file)',
      'The 5-step generation pipeline and the 4-layer agent loop',
      'LLM provider swapped five times in two days before settling on Replicate',
      'Found the manager quality gate had never once run — every post until then published ungated',
    ],
    reality: 'One account: mine. Five posts.',
  },
  {
    title: 'Full-speed sprawl',
    from: '2026-06-08', to: '2026-06-17', commits: 89,
    gist: 'The peak, and never matched again. Eight PRs on Jun 12, nine on Jun 15.',
    built: [
      'WYSIWYG editor + AI section revision; embed HTML rewritten five times in two days',
      'Full SEO stack: canonical, OG, JSON-LD, RSS, robots, sitemaps, llms.txt',
      'Real security pass — stored XSS, IDOR, cron-auth bypass, SSRF — plus rate limiting',
      'SERP analysis, keyword research, programmatic SEO, AEO scoring',
      'Jun 15: the nightly cron that builds and self-merges a feature at 3am',
    ],
    reality: 'Still one account. 16 posts. Nobody had seen the product.',
  },
  {
    title: 'The cash register',
    from: '2026-06-22', to: '2026-06-30', commits: 44,
    gist: 'The whole revenue apparatus, built in a day, for an MRR of zero — 48 hours before the only two real users left.',
    built: [
      'Jun 27: the dark redesign begins — comps, landing rebuild, dark skin app-wide',
      'Jun 28, 22 commits: Google sign-in, Stripe billing, refund funnel with exit survey, admin MRR overview, daily owner digest, denial-of-wallet anomaly detection',
      'Google Search Console loop + self-serve GSC setup',
    ],
    reality: 'The only two outside signups arrive Jun 28. One live charge is declined by the bank. Both gone by Jun 30. Nobody but me has signed in since.',
  },
  {
    title: 'The loop',
    from: '2026-07-01', to: '2026-07-20', commits: 92,
    gist: 'Ninety-two commits, almost none of which could reach a customer.',
    built: [
      'Jul 1: the Write page redesigned four separate times in one day',
      'Agent loop rebuilt on markdown working memory; multipurpose assistant chatbot (6 PRs)',
      'Customer-owned hostnames via CNAME, brand-colour extraction, autopilot publish bar',
      'Jul 19: an hour of landing-page pixel fixes at 00:28, then a genuinely good cost + stress analysis at 07:59',
      'Jul 20: light theme, grayscale palette, new logo — a full visual reversal',
    ],
    reality: 'Zero new signups for the entire month.',
  },
  {
    title: 'The correction that almost worked',
    from: '2026-07-22', to: '2026-08-05', commits: 98,
    gist: 'The best engineering of the project — and it was nearly all repair.',
    built: [
      'Jul 25: theme reversed back to dark, five days after going light. Then #172 — enforce the quota every plan is sold on',
      'Jul 26, 23 commits: the strategy model is actually called, regenerate actually rewrites, reports scoped per customer, and #195 — the first test that a new account works from an empty database',
      'Aug 1: twelve consecutive strategy/scheduler fixes. Every monthly plan had been dying on an unparseable shape; a whole platform-day published in one unguarded loop',
      'Aug 5: #244 launch readiness — indexability, sitemap submission, publish gate',
    ],
    reality: 'Five seeded example.com accounts land in the production database on Aug 2 and are still there.',
  },
  {
    title: 'Three runs at a customer',
    from: '2026-08-08', to: '2026-08-27', commits: 6,
    gist: 'Three separate machines built for reaching people. None of them was ever pointed at one.',
    built: [
      'Aug 8: beta infrastructure — give the product away on purpose',
      'Aug 9 + Aug 14: two coupon batches, 26 seats total',
      'Aug 14: Reddit beta-tester screening and DM drafting',
      'Aug 15 → Aug 26: eleven days, one commit — the longest silence in the project',
      'Aug 26–27: 30 leads researched, 30 emails written, a Gmail sender built. Then the MCP server ships the same afternoon',
    ],
    reality: 'Codes redeemed: 0. Prospects screened: 0. Emails sent: 0.',
  },
  {
    title: 'Retreat',
    from: '2026-08-29', to: '2026-09-04', commits: 11,
    gist: 'Asked for a new language on Aug 29, two days after writing 30 emails that were never sent.',
    built: [
      'Publication + UI language across four locales; three of the commits fix the i18n checker\'s own regex',
      'Sep 1: "scope the X source for outreach" → "start phase 1" → interrupted. The MCP onboarding install ships instead',
      'Sep 4: this planner\'s neighbour — an operator\'s planner, 31 tests, for a service with no customers',
    ],
    reality: 'Unchanged.',
  },
];

/* ── milestones ────────────────────────────────────────────────────────── */

export type Milestone = {
  date: string | null; // null = never happened
  label: string;
  /** true when this is a thing that reached a person outside the building. */
  outward: boolean;
};

/**
 * Ordered by the day each landed, EXCEPT the last one, which has no day. That
 * ordering is the finding: the cash register (day 28) shipped before the meter
 * it bills against (day 55), which shipped before the first proof a stranger
 * could get through the front door at all (day 56).
 */
export const MILESTONES: Milestone[] = [
  { date: '2026-06-28', label: 'First outside signup', outward: true },
  { date: '2026-06-28', label: 'Stripe billing live', outward: false },
  { date: '2026-06-30', label: 'Last sign-in by anyone but me', outward: true },
  { date: '2026-07-25', label: 'Quota enforcement — what the plans were sold on', outward: false },
  { date: '2026-07-26', label: 'First test that a new account can onboard at all', outward: false },
  { date: '2026-08-05', label: '"Launch readiness"', outward: false },
  { date: '2026-08-14', label: '26 beta seats created', outward: true },
  { date: '2026-08-26', label: '30 leads researched, 30 emails written', outward: true },
  { date: null, label: 'First email actually sent', outward: true },
];

/** Milestones pinned to the week bar they belong under. */
export function milestonesInWeek(weekStart: string): Milestone[] {
  const from = Date.parse(`${weekStart}T00:00:00Z`);
  const to = from + 7 * DAY_MS;
  return MILESTONES.filter((m) => {
    if (!m.date) return false;
    const t = Date.parse(`${m.date}T00:00:00Z`);
    return t >= from && t < to;
  });
}

/** "day 56" / "never". */
export function dayLabel(m: Milestone): string {
  return m.date ? `day ${dayOf(m.date)}` : 'never';
}

/** Short axis label for a week bar: "Jun 8". */
export function weekLabel(start: string): string {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, m, d] = start.split('-');
  return `${MON[Number(m) - 1]} ${Number(d)}`;
}

/** Bar height as a percentage of the tallest week. Zero weeks keep a hairline. */
export function barPct(commits: number): number {
  if (commits === 0) return 0;
  return Math.max(4, Math.round((commits / PEAK_COMMITS) * 100));
}

/* ── the built ledger ──────────────────────────────────────────────────── */

/** Static counts from the repo — the left-hand column of the two ledgers. */
export const BUILT = [
  { label: 'Commits', value: TOTAL_COMMITS.toLocaleString() },
  { label: 'Pull requests', value: '262' },
  { label: 'Lines of TypeScript', value: '~52,900' },
  { label: 'Test files', value: '114' },
  { label: 'Days', value: String(dayOf(END)) },
];
