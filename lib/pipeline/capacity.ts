/**
 * Scheduler capacity — the single place that decides how much work one tick may
 * start, and whether the platform can actually deliver what has been sold.
 *
 * The drain used to take a hardcoded 3 posts per tick on a once-daily cron, so
 * total platform throughput was a constant (~90 posts/month) no matter how many
 * customers were paying. A single Agency plan (150/mo) exceeded the whole
 * platform on its own, and every tier silently under-delivered as soon as a
 * handful of customers signed up. The number was invisible, so nothing ever
 * flagged it.
 *
 * Throughput is now derived from the two things that actually govern it:
 *
 *   posts/day = ticks per day      (the cron schedule)
 *             × posts per tick     (how many fit in the function's time budget)
 *
 * Neither is guessed. Ticks/day is parsed from `vercel.json`, which stays the
 * only source of truth for the schedule. Posts/tick falls out of a wall-clock
 * budget measured against how long recent generations actually took — read back
 * from `posts.generation_log`, so the estimate tracks reality as the model, the
 * prompt, or the plan's CPU changes.
 *
 * The practical consequence: raising throughput is a schedule change, not a
 * code change. Moving the scheduler from daily to hourly multiplies capacity by
 * 24 and every number in here follows automatically.
 *
 * Everything in this file is pure, so the arithmetic is unit-testable without a
 * clock, a database, or a deploy.
 */
import vercelConfig from '../../vercel.json';
import { PLANS, isPlanId } from '../plans';

// ── tunables ───────────────────────────────────────────────────────────────
// Vercel kills the function at maxDuration. Stop short of it so the tick can
// finish its bookkeeping and return a real response instead of a timeout.
export const TICK_SAFETY_MS = 15_000;

// Search Console sync runs at the end of the tick and used to be starved by the
// drain whenever the queue was deep — the loop's own feedback signal was the
// first thing to go. Reserve room the drain may never spend.
export const GSC_RESERVE_MS = 45_000;

// Search Console publishes at daily granularity, so there is nothing to gain
// from syncing it more than once a day. On a sub-daily schedule the sync runs
// on the tick at this UTC hour and every other tick gets its reserve back to
// spend on generation.
export const GSC_SYNC_HOUR_UTC = 4;

/**
 * Should this tick spend time on the Search Console sync?
 *
 * Gated on the minute as well as the hour. Gating on the hour alone is exact
 * only while the scheduler fires once an hour: on the every-15-minutes schedule
 * that CLAUDE.md names as the next throughput step, all four ticks inside the
 * sync hour would qualify — syncing Google four times for data it publishes
 * daily, and withholding GSC_RESERVE_MS from the drain on four ticks instead of
 * one. The schedule's own first minute is the single tick that syncs.
 */
export function shouldSyncGsc(
  now: Date,
  ticksPerDayCount: number,
  tickMinutes: number[] = schedulerTickMinutes(),
): boolean {
  // On a once-daily schedule the sole tick must do it, whatever hour it lands on.
  if (ticksPerDayCount <= 1) return true;
  if (now.getUTCHours() !== GSC_SYNC_HOUR_UTC) return false;
  // An unparseable schedule leaves no minute to single out; the hour gate alone
  // is the old behaviour and still syncs, which beats never syncing at all.
  if (!tickMinutes.length) return true;
  return now.getUTCMinutes() === Math.min(...tickMinutes);
}

// Used until enough real generations have been observed to measure.
export const DEFAULT_GENERATION_MS = 90_000;

// Safety ceiling on how many queued posts one tick will even consider. Time is
// the real limiter; this just keeps the candidate list sane on a deep backlog.
export const MAX_POSTS_PER_TICK = 25;

// A post sitting in a working status longer than this was killed mid-flight
// (platform timeout, deploy, OOM). Comfortably above any single generation.
export const STALE_GENERATION_MS = 30 * 60_000;

// Statuses that mean "a generation is in progress" — the drain skips these, so
// anything stuck here is throughput lost until it's reclaimed.
export const WORKING_STATUSES: string[] = ['researching', 'writing'];

// Nominal month length for the monthly capacity figure.
const DAYS_PER_MONTH = 30;

// ── cron → ticks per day ───────────────────────────────────────────────────

/** Expand one standard cron field into the values it matches. */
function expandField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (!Number.isInteger(step) || step < 1) return [];

    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) return [];
      lo = a;
      hi = b;
    } else {
      const n = Number(range);
      if (!Number.isInteger(n)) return [];
      lo = n;
      hi = n;
    }
    if (lo < min || hi > max || lo > hi) return [];
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out];
}

/**
 * How many times a 5-field cron fires on a day it runs.
 *
 * Day-of-month / day-of-week restrictions are deliberately not modelled: this
 * answers "how many ticks do we get on an active day", which is what the drain
 * budget and the capacity figures need. The scheduler's own cron runs daily.
 * An unparseable schedule falls back to 1 — under-promising is the safe error.
 */
export function ticksPerDay(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return 1;
  const minutes = expandField(parts[0], 0, 59);
  const hours = expandField(parts[1], 0, 23);
  if (!minutes.length || !hours.length) return 1;
  return minutes.length * hours.length;
}

/** The scheduler's path in vercel.json — the schedule's single source of truth. */
export const SCHEDULER_CRON_PATH = '/api/cron/scheduler';

export function schedulerCron(): string {
  const crons = (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? [];
  return crons.find((c) => c.path === SCHEDULER_CRON_PATH)?.schedule ?? '0 9 * * *';
}

export function schedulerTicksPerDay(): number {
  return ticksPerDay(schedulerCron());
}

/**
 * Minutes past the hour the scheduler fires on, from its own cron.
 *
 * Lets once-a-day tail work pick exactly one tick on a sub-hourly schedule
 * instead of every tick inside the chosen hour. Empty when unparseable.
 */
export function schedulerTickMinutes(cron: string = schedulerCron()): number[] {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return [];
  return expandField(parts[0], 0, 59);
}

// ── per-tick time budget ───────────────────────────────────────────────────

/** Wall-clock a single tick may spend, given the route's maxDuration. */
export function tickBudgetMs(maxDurationSec: number, safetyMs: number = TICK_SAFETY_MS): number {
  return Math.max(0, Math.round(maxDurationSec * 1000) - safetyMs);
}

/**
 * Tick budget, honouring a `GROVE_TICK_BUDGET_MS` override.
 *
 * A route's declared `maxDuration` is a request, not a guarantee: Vercel Hobby
 * kills functions at 60s however much they ask for. Trusting the declared 300s
 * there would have the drain start an article it cannot finish, every tick.
 * Set the override to the plan's real ceiling and the drain stops cleanly
 * instead. Left unset on Pro, where maxDuration is honoured.
 */
export function resolveTickBudgetMs(
  maxDurationSec: number,
  envValue?: string | null,
  safetyMs: number = TICK_SAFETY_MS,
): number {
  const override = Number(envValue);
  if (Number.isFinite(override) && override > 0) {
    return Math.max(0, Math.round(override) - safetyMs);
  }
  return tickBudgetMs(maxDurationSec, safetyMs);
}

/** Is there room to start one more unit of work of `estimateMs`? */
export function hasRoomFor(elapsedMs: number, budgetMs: number, estimateMs: number): boolean {
  return elapsedMs + estimateMs <= budgetMs;
}

/** How many generations fit in a tick, after reserving the tail phases. */
export function postsPerTick(
  budgetMs: number,
  estimateMs: number,
  reserveMs: number = GSC_RESERVE_MS,
  cap: number = MAX_POSTS_PER_TICK,
): number {
  const usable = budgetMs - reserveMs;
  if (usable <= 0 || estimateMs <= 0) return 0;
  return Math.max(0, Math.min(cap, Math.floor(usable / estimateMs)));
}

// ── measuring real generation cost ─────────────────────────────────────────

export type LogLike = ({ ts?: number; step?: string } | null)[] | null | undefined;

/**
 * The steps that run inside `generatePost`.
 *
 * A post's generation_log is NOT a record of one generation: /api/cron/images
 * keeps appending `cover_image` and `inline_images` entries for days after the
 * article was written. Measuring first-to-last entry therefore reports the age
 * of the post, not the cost of generating it — real logs in production span
 * ~150 seconds of pipeline followed by six days of image backfill.
 */
const PIPELINE_STEPS = new Set([
  'queued', 'site_profile', 'research', 'topic_refiner', 'writer', 'manager', 'persist',
]);

/**
 * Longest a single generation could plausibly take. A generation is bounded by
 * the function ceiling, so anything above this is a measurement artefact rather
 * than a slow article — discard it instead of letting it poison the estimate.
 */
export const MAX_PLAUSIBLE_GENERATION_MS = 20 * 60_000;

function timestamps(log: LogLike, steps?: Set<string>): number[] {
  if (!Array.isArray(log)) return [];
  return log
    .filter((e) => !steps || (e && typeof e.step === 'string' && steps.has(e.step)))
    .map((e) => (e && typeof e.ts === 'number' ? e.ts : NaN))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Wall time of a finished generation, measured over the pipeline steps only.
 *
 * Returns null for anything unmeasurable or implausible, so a bad sample is
 * dropped rather than skewing the drain — an over-estimate here stops the tick
 * from starting any work at all.
 */
export function generationDurationMs(log: LogLike): number | null {
  const ts = timestamps(log, PIPELINE_STEPS);
  if (ts.length < 2) return null;
  const d = Math.max(...ts) - Math.min(...ts);
  if (d <= 0 || d > MAX_PLAUSIBLE_GENERATION_MS) return null;
  return d;
}

/**
 * Pessimistic estimate (p80) of what the next generation will cost.
 *
 * Biased high on purpose: under-filling a tick loses a little throughput, but
 * over-filling gets the function killed mid-article, which strands the post and
 * loses the whole slot until it's reclaimed.
 */
export function estimateGenerationMs(
  samples: number[],
  fallback: number = DEFAULT_GENERATION_MS,
): number {
  const clean = samples.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!clean.length) return fallback;
  return clean[Math.min(clean.length - 1, Math.floor(clean.length * 0.8))];
}

// ── reclaiming work the platform killed ────────────────────────────────────

/** Most recent progress timestamp in a post's generation log. */
export function lastProgressMs(log: LogLike): number | null {
  const ts = timestamps(log);
  return ts.length ? Math.max(...ts) : null;
}

/**
 * Has a post in a working status been abandoned?
 *
 * A live generation always carries a timestamp — the claim seeds one before
 * `generatePost` runs — so a working row with no timestamps at all is a
 * leftover from a killed run and is safe to reclaim.
 */
export function isStranded(
  log: LogLike,
  nowMs: number,
  staleAfterMs: number = STALE_GENERATION_MS,
): boolean {
  const last = lastProgressMs(log);
  if (last === null) return true;
  return nowMs - last >= staleAfterMs;
}

// ── platform capacity vs what's been sold ──────────────────────────────────

/**
 * Posts/month promised by the subscriptions passed in.
 *
 * Counts the same statuses entitlement does (active + trialing): a trialing
 * customer is owed delivery exactly like a paying one. Rows on an unrecognised
 * plan contribute nothing — a price id we can't map is a billing problem, not a
 * capacity one, and guessing a quota here would distort the report.
 */
export function committedPostsPerMonth(
  subs: { plan?: string | null; stripe_status?: string | null }[],
): number {
  let total = 0;
  for (const s of subs ?? []) {
    const status = (s?.stripe_status ?? '').toLowerCase();
    if (status !== 'active' && status !== 'trialing') continue;
    const plan = s?.plan;
    if (isPlanId(plan)) total += PLANS[plan].postsQuota;
  }
  return total;
}

export type CapacityReport = {
  ticksPerDay: number;
  postsPerTick: number;
  postsPerDay: number;
  postsPerMonth: number;
  committedPerMonth: number;
  headroomPerMonth: number;
  utilization: number; // committed ÷ deliverable; > 1 means oversold
  oversubscribed: boolean;
};

/**
 * What the platform can deliver this month vs what subscriptions have promised.
 *
 * `committedPerMonth` is the sum of every live subscription's plan quota. When
 * it exceeds what the schedule can produce, customers are being sold posts that
 * physically cannot be generated — the failure mode that made this module
 * necessary. Surfaced on the admin overview so it's caught before customers
 * notice rather than after.
 */
export function capacityReport(input: {
  ticksPerDay: number;
  postsPerTick: number;
  committedPerMonth: number;
  daysPerMonth?: number;
}): CapacityReport {
  const { ticksPerDay: tpd, postsPerTick: ppt, committedPerMonth } = input;
  const daysPerMonth = input.daysPerMonth ?? DAYS_PER_MONTH;
  const postsPerDay = Math.max(0, tpd) * Math.max(0, ppt);
  const postsPerMonth = postsPerDay * daysPerMonth;
  const committed = Math.max(0, committedPerMonth);
  return {
    ticksPerDay: tpd,
    postsPerTick: ppt,
    postsPerDay,
    postsPerMonth,
    committedPerMonth: committed,
    headroomPerMonth: postsPerMonth - committed,
    utilization: postsPerMonth > 0 ? committed / postsPerMonth : committed > 0 ? Infinity : 0,
    oversubscribed: committed > postsPerMonth,
  };
}
