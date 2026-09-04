/**
 * Every day from the first commit to now, and what happened on it — PURE.
 *
 * The companion to lib/journey.ts, which summarises the same span in seven
 * phases. This one refuses to summarise: one entry per calendar day, including
 * the days nothing happened, because the empty runs are the finding. Aug 16–26
 * is eleven consecutive blank columns and that stretch says more than any
 * chart of it would.
 *
 * `did` holds short phrases, not commit subjects — a subject line is written
 * for the diff and reads as noise in a column 120px wide. `note` is the
 * business fact for that day and renders in red; it is deliberately sparse,
 * because most days did not have one, and that is itself the point.
 *
 * Transcribed from `git log --no-merges` over 2026-06-01..2026-09-04 — merges
 * excluded because a merge commit is the same work counted twice, and the
 * point of a per-day column is what was done that day. 325 at the commit that
 * added this file; lib/journey.ts's 397 counts merges too, which is why the
 * two totals differ and neither is wrong.
 *
 * The guard in tests is self-consistency: RECORDED_COMMITS must equal the
 * declared TRANSCRIBED_TOTAL, so retyping one day's count fails until the
 * total is updated on purpose. It cannot check the repo — a unit test has no
 * business shelling out to git — so the discipline is: re-run the diff script
 * in the PR body when you extend the range.
 */

export type Day = {
  date: string;            // YYYY-MM-DD
  commits: number;
  did: string[];
  /** The business fact, if the day had one. Rendered in red. */
  note?: string;
  /** Milestone weight — 'out' reached a stranger, 'in' did not. */
  mark?: 'out' | 'in';
};

const DAY_MS = 86_400_000;

/** Only the days something is recorded for. Everything else fills in as quiet. */
const RECORDED: Day[] = [
  { date: '2026-06-01', commits: 6, did: ['Repo created, first Vercel deploy', 'Swapped Anthropic for Gemini'] },
  { date: '2026-06-02', commits: 10, did: ['Domain verification, three ways', 'LLM provider swapped four more times', 'Review screen at /posts/[id]'] },
  { date: '2026-06-03', commits: 21, did: ['The whole pipeline, in one day', 'Embed API, editorial brief, covers', 'Live pipeline timeline', 'Calendar + post editor'] },
  { date: '2026-06-04', commits: 4, did: ['Topic suggestions — dropped the LLM for a template'] },
  { date: '2026-06-06', commits: 3, did: ['The 4-layer agent loop', 'Dashboard: strategy, reviews, analytics'] },
  { date: '2026-06-07', commits: 8, did: ['Found the manager gate had never once run', 'Strategy → pipeline → calendar linked', 'Social auto-publish', 'First tests'] },
  { date: '2026-06-08', commits: 3, did: ['WYSIWYG editor, click-to-edit', 'Quality scores + a score floor'] },
  { date: '2026-06-09', commits: 2, did: ['Manager routes to review, never deletes'] },
  { date: '2026-06-10', commits: 7, did: ['Manager scoring fix — the uniform 3/100', 'Embed HTML rewritten four times'] },
  { date: '2026-06-11', commits: 4, did: ['SEO-grade blog: canonical, OG, JSON-LD, RSS'] },
  { date: '2026-06-12', commits: 10, did: ['Eight PRs: OAuth popup, weekly brief, digest email', 'Subdomain blogs', 'Blog index v2 + design polish'] },
  { date: '2026-06-13', commits: 4, did: ['Embed full-blog mode', 'CLAUDE.md written'] },
  { date: '2026-06-14', commits: 8, did: ['Security pass: XSS, IDOR, SSRF, cron auth', 'Rate limits on the endpoints that cost money', 'Keyword research + programmatic SEO'] },
  { date: '2026-06-15', commits: 10, did: ['Nine PRs of AEO: llms.txt, @graph, takeaways', 'The nightly self-merging cron created'] },
  { date: '2026-06-16', commits: 8, did: ['SERP analysis + coverage gap', 'Three "premium design passes"'] },
  { date: '2026-06-17', commits: 3, did: ['Bold landing redesign', 'Mobile dashboard shell'] },
  { date: '2026-06-22', commits: 3, did: ['Search Console loop — real ranking data at last'] },
  { date: '2026-06-24', commits: 1, did: ['Self-serve GSC setup'] },
  { date: '2026-06-27', commits: 8, did: ['The dark redesign begins — comps + landing'] },
  {
    date: '2026-06-28', commits: 12, mark: 'out',
    did: ['Stripe billing', 'Refund funnel with exit survey', 'Admin MRR overview + anomaly alerts', 'Google sign-in'],
    note: 'Two strangers sign up. One live charge is declined by the bank.',
  },
  { date: '2026-06-29', commits: 3, did: ['Consistent nav + onboarding guide', 'Analytics wired to real GSC'] },
  {
    date: '2026-06-30', commits: 3, mark: 'out',
    did: ['Overview tweaks', 'Dark writing UI'],
    note: 'Both strangers gone. Nobody outside has signed in since.',
  },
  { date: '2026-07-01', commits: 7, did: ['Write page redesigned four times, in one day'] },
  { date: '2026-07-02', commits: 1, did: ['Agent loop rebuilt on markdown working memory'] },
  { date: '2026-07-03', commits: 2, did: ['Design tokens unified', 'Month-2 strategy stall self-heals'] },
  { date: '2026-07-06', commits: 2, did: ['Manager gate made honest, not decorative', 'Search equity accrues to the customer'] },
  { date: '2026-07-07', commits: 3, did: ['Resume-on-retry, working covers, faster blog'] },
  { date: '2026-07-08', commits: 6, did: ['Admin Users page — retention, for three accounts', 'Reads count humans, not bots'] },
  { date: '2026-07-09', commits: 1, did: ["Extract the customer's brand palette"] },
  { date: '2026-07-10', commits: 7, did: ['GitHub repo → article formats', 'Owner-adjustable autopilot bar'] },
  { date: '2026-07-11', commits: 5, did: ['Landing: tell the truth — real pricing, legal pages', 'Planner stops eating its own keywords'] },
  { date: '2026-07-12', commits: 3, did: ['One sign-in surface', 'Hero mock matches the real dashboard'] },
  { date: '2026-07-13', commits: 5, did: ['Blogs on customer-owned hostnames (CNAME)', 'SEO foundation for the marketing site'] },
  { date: '2026-07-14', commits: 1, did: ['Embed page readable on the dark skin'] },
  { date: '2026-07-15', commits: 4, did: ['Social composer', 'Social copy had been silently empty'] },
  { date: '2026-07-16', commits: 7, did: ['Mobile pass', 'Four X-specific fixes', 'Pipeline article page redesigned'] },
  { date: '2026-07-17', commits: 1, did: ['Landing spacing'] },
  { date: '2026-07-18', commits: 3, did: ['The assistant chatbot arrives'] },
  {
    date: '2026-07-19', commits: 12,
    did: ['00:28 — the white line on the landing edge', '07:59 — real cost + stress analysis', 'Yearly plans, SSRF fix, assistant grounding'],
  },
  { date: '2026-07-20', commits: 3, did: ['Light theme, grayscale palette, new logo'] },
  { date: '2026-07-22', commits: 2, did: ['Embed feed fixes'] },
  {
    date: '2026-07-25', commits: 15, mark: 'in',
    did: ['Theme reversed back to dark, five days later', 'Comp-fidelity rebuild of four pages', 'Quota enforcement — day 55'],
  },
  {
    date: '2026-07-26', commits: 23, mark: 'in',
    did: ['The strategy model is actually called', 'Regenerate actually rewrites', 'First test a new account can onboard — day 56'],
  },
  { date: '2026-07-27', commits: 7, did: ['PostHog, comped accounts, cost recording'] },
  { date: '2026-07-28', commits: 1, did: ['Say what grove does in plain language'] },
  { date: '2026-07-29', commits: 5, did: ['Plain-language landing pass', 'Upload your own images'] },
  { date: '2026-07-30', commits: 2, did: ['The editor image tool was dead on every post'] },
  { date: '2026-07-31', commits: 3, did: ["Hosted blogs wear the customer's design"] },
  {
    date: '2026-08-01', commits: 14,
    did: ['Twelve straight strategy/scheduler fixes', 'Every monthly plan had been dying silently', 'A platform-day published in one unguarded loop'],
  },
  {
    date: '2026-08-02', commits: 11,
    did: ['Eleven embed, brand and DNS fixes'],
    note: 'Five example.com fixtures seeded into the production database.',
  },
  { date: '2026-08-03', commits: 4, did: ['The autopilot gate had been holding every draft', 'Which queries belong to which page'] },
  { date: '2026-08-04', commits: 3, did: ['Planner was told to compete with our own page-2 URLs'] },
  { date: '2026-08-05', commits: 1, mark: 'in', did: ['Launch readiness — day 66'] },
  { date: '2026-08-08', commits: 1, did: ['Beta: give the product away on purpose'] },
  { date: '2026-08-09', commits: 0, did: [], mark: 'out', note: 'LAUNCH52 created. Never redeemed.' },
  { date: '2026-08-10', commits: 1, did: ['Article performance — and when it went out'] },
  {
    date: '2026-08-14', commits: 2, mark: 'out',
    did: ['Reddit beta-tester screening + DM drafting'],
    note: '25 beta seats created. Never redeemed.',
  },
  { date: '2026-08-15', commits: 1, did: ['Reddit 403s from Vercel — app-only OAuth'] },
  {
    date: '2026-08-26', commits: 0, did: [], mark: 'out',
    note: '30 leads researched, 30 emails written. None sent.',
  },
  {
    date: '2026-08-27', commits: 1,
    did: ["MCP: put grove's articles inside an existing blog"],
    note: 'Emails rewritten for better hooks. Still not sent.',
  },
  { date: '2026-08-29', commits: 1, did: ['Asked for more languages. The i18n stretch begins.'] },
  { date: '2026-08-30', commits: 4, did: ['A Korean blog wrote English, and the manager insisted'] },
  { date: '2026-08-31', commits: 2, did: ['One language per site'] },
  { date: '2026-09-01', commits: 2, did: ['82 more strings the checker never scanned', '"start phase 1" → interrupted'] },
  { date: '2026-09-02', commits: 1, did: ['[object Object] in a customer’s frontmatter'] },
  { date: '2026-09-04', commits: 4, did: ["An operator's planner, 31 tests", 'This calendar'] },
];

export const FIRST_DAY = RECORDED[0].date;
export const LAST_DAY = RECORDED[RECORDED.length - 1].date;

/** Total commits across every recorded day. */
export const RECORDED_COMMITS = RECORDED.reduce((n, d) => n + d.commits, 0);

/** What the transcription summed to when it was last reconciled with the repo. */
export const TRANSCRIBED_TOTAL = 325;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Weekday label. UTC throughout — these are civil dates, not instants. */
export function weekdayOf(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function isWeekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** "Jun" — only rendered on the 1st, or on the first day of the range. */
export function monthLabel(date: string): string {
  return MONTHS[Number(date.slice(5, 7)) - 1];
}

export function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

/**
 * Every day from the first commit to the last, quiet days included.
 *
 * The gaps are the reason this returns a dense range rather than the recorded
 * days alone: a calendar that skips the empty weeks would show the same work
 * as a steady grind, when the shape of it is a burst that ran out.
 */
export function allDays(): Day[] {
  const byDate = new Map(RECORDED.map((d) => [d.date, d]));
  const out: Day[] = [];
  const end = Date.parse(`${LAST_DAY}T00:00:00Z`);
  for (let t = Date.parse(`${FIRST_DAY}T00:00:00Z`); t <= end; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, commits: 0, did: [] });
  }
  return out;
}

/** Longest run of days with no commits and nothing recorded. */
export function longestSilence(days: Day[]): { from: string; to: string; length: number } | null {
  let best: { from: string; to: string; length: number } | null = null;
  let start: string | null = null;
  let n = 0;
  for (const d of days) {
    const quiet = d.commits === 0 && d.did.length === 0 && !d.note;
    if (quiet) {
      if (start === null) { start = d.date; n = 0; }
      n++;
      if (!best || n > best.length) best = { from: start, to: d.date, length: n };
    } else {
      start = null; n = 0;
    }
  }
  return best;
}
