/**
 * Month rollover — how a domain gets its next plan BEFORE the month it covers.
 *
 * THE DEAD ZONE THIS EXISTS TO CLOSE. A month's publishing plan was only ever
 * buildable during the month it covers: `monthBounds()` keys off `now`, so on
 * 2026-08-01T00:00Z no domain had an August plan and none could be built until
 * that instant. `/api/cron/strategy` then builds ONE domain per hourly
 * invocation — planning needs ~3-4 uninterrupted minutes, so one really is the
 * ceiling — which made the outage N hours wide for N paying domains:
 *
 *     2 domains  → ~2h        (invisible, which is why it survived)
 *    20 domains  → last plan lands 19:45 UTC on the 1st
 *    30 domains  → spills past midnight into the 2nd
 *    50 domains  → the 1st through 3rd are dead air for the tail
 *
 * Meanwhile the drain sat idle with a healthy ~47 posts/day of capacity and
 * nothing queued, because `materializeDuePlanSlots` reads the active plan and
 * the previous month's slots were all consumed.
 *
 * THE FIX IS TWO CHEAP HALVES, and the split is the whole point:
 *
 *   1. STAGE (expensive, early). During the last few days of month M the
 *      strategy cron builds month M+1's plan and stores it INACTIVE. That work
 *      is still one domain per hour, but it now has `PLAN_LOOKAHEAD_DAYS × 24`
 *      invocations of runway instead of racing the boundary.
 *
 *   2. ACTIVATE (cheap, on time). The scheduler tick promotes every staged plan
 *      whose month has arrived — a single UPDATE per domain, no LLM — so ALL
 *      domains roll over in one tick. This is what removes the N-hour scaling:
 *      activation cost is flat in the number of customers.
 *
 * WHY STAGED PLANS ARE INACTIVE. Six places read the live plan as
 * `.eq('active', true).order('month', desc).limit(1)` — the calendar, the
 * strategy page, both chat routes, the weekly digest, and generate.ts's slot
 * matcher. Inserting next month's plan as active would win that ordering while
 * the current month is still running: `materializeDuePlanSlots` would switch to
 * the future plan and silently abandon the current month's remaining slots,
 * trading a dead zone at the start of the month for one at the end. Staging
 * preserves the "exactly one active plan" invariant, so none of those consumers
 * change at all.
 *
 * Everything here is pure so the rollover is unit-testable without a clock or a
 * database — the failure it fixes only reproduces on the 1st of a month.
 */

/**
 * How early to start building next month's plan.
 *
 * Sized against the runway it buys, not a feeling: at one plan per hourly tick,
 * 7 days is 168 invocations, which covers far more domains than the schedule
 * could serve articles for (~47 posts/day ÷ 12 posts on Starter ≈ 117 domains).
 * Raise it only if the planner gets slower or the customer count outgrows that.
 */
export const PLAN_LOOKAHEAD_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** First of `now`'s month, UTC. */
export function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** First of the month after `now`, UTC. */
export function startOfNextMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** The `strategies.month` key for a date — a Postgres `date`, so 'YYYY-MM-DD'. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fractional days left before the month turns over. */
export function daysUntilNextMonth(now: Date): number {
  return (startOfNextMonthUTC(now).getTime() - now.getTime()) / MS_PER_DAY;
}

export type PlanTarget = {
  /** 'YYYY-MM-01' */
  month: string;
  /** Build it inactive — it covers a month that hasn't started yet. */
  staged: boolean;
};

/**
 * Which months the planner should make sure exist, most urgent first.
 *
 * The current month always leads: a domain with no live plan is publishing
 * nothing right now, which beats getting a head start on next month. Staging is
 * strictly the tail of the list, so a backlog of real gaps drains before any
 * lookahead work begins.
 */
export function planningTargets(now: Date, lookaheadDays = PLAN_LOOKAHEAD_DAYS): PlanTarget[] {
  const targets: PlanTarget[] = [{ month: monthKey(startOfMonthUTC(now)), staged: false }];
  if (daysUntilNextMonth(now) <= lookaheadDays) {
    targets.push({ month: monthKey(startOfNextMonthUTC(now)), staged: true });
  }
  return targets;
}

export type StrategyRowLite = {
  id: string;
  /** 'YYYY-MM-DD' as Postgres returns a `date`. */
  month: string;
  active: boolean;
  created_at?: string | null;
};

export type Rollover = {
  /** Staged plan to promote, or null when there's nothing to roll over. */
  activateId: string | null;
  /** Rows to switch off, so exactly one plan is ever active. */
  deactivateIds: string[];
};

/**
 * Decide the rollover for one domain from its strategy rows.
 *
 * Deliberately conservative — it only ever promotes a staged plan for the
 * CURRENT month, and only when nothing is already live for that month:
 *
 *  - A month already served by an active plan is left completely alone, so a
 *    plan a human built or revised mid-month is never overwritten by a staged
 *    one, and re-running the tick is a no-op.
 *  - Inactive rows for OTHER months are ignored. They're superseded revisions
 *    (apply-revision deactivates the old row and inserts a new one), and
 *    resurrecting one would republish a month that's already over.
 *  - Every active row is deactivated when a promotion happens, including plans
 *    older than last month, so a domain that lay dormant for a while can't end
 *    up with two live plans.
 */
export function planToActivate(rows: StrategyRowLite[], now: Date): Rollover {
  const current = monthKey(startOfMonthUTC(now));
  const forCurrent = rows.filter((r) => r.month === current);

  // Something is already live for this month — nothing to roll over.
  if (forCurrent.some((r) => r.active)) return { activateId: null, deactivateIds: [] };

  // Newest staged row wins. There is normally exactly one; the tiebreak just
  // makes a retry after a partial failure deterministic.
  const staged = forCurrent
    .filter((r) => !r.active)
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  if (!staged.length) return { activateId: null, deactivateIds: [] };

  return {
    activateId: staged[0].id,
    deactivateIds: rows.filter((r) => r.active).map((r) => r.id),
  };
}
