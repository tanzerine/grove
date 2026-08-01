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

export type PlanCandidate = {
  id: string;
  /** Domain creation time — the tiebreak, so the order stays deterministic. */
  created_at?: string | null;
  /**
   * When the planner last STARTED a build for this domain (migration 0031).
   * Stamped before the LLM call, not after, so a build the platform kills
   * mid-flight still counts as an attempt — see /api/cron/strategy.
   */
  strategy_attempted_at?: string | null;
};

/**
 * Order the domains a planning tick should try — least-recently-attempted
 * first, never-attempted before everyone.
 *
 * THE OUTAGE THIS EXISTS TO PREVENT. The planner builds one domain per hourly
 * invocation, and it used to take whichever unplanned domain came first by
 * `domains.created_at` — a fixed order. Only a SUCCESSFUL build removes a
 * domain from that queue, so a domain whose build failed was first again on
 * the next tick, and the next, forever. One domain that cannot be planned
 * therefore starved every domain behind it: on 2026-08-01 the platform's
 * oldest domain failed every tick and no other customer was planned all day.
 * With no live plan, `materializeDuePlanSlots` queues nothing, the drain has
 * nothing to draft, and nothing publishes — the whole autopilot, stopped by
 * one bad row, silently.
 *
 * Rotating on attempt rather than success is what fixes it: a permanently
 * broken domain now costs the platform one tick per rotation instead of all of
 * them, and it is still retried on its turn.
 */
export function planningQueue<T extends PlanCandidate>(pending: T[]): T[] {
  return [...pending].sort((a, b) => {
    // '' (never attempted) sorts before any ISO timestamp — exactly the wanted
    // priority, and it keeps a domain that has never had a plan at the front.
    const attemptA = a.strategy_attempted_at ?? '';
    const attemptB = b.strategy_attempted_at ?? '';
    if (attemptA !== attemptB) return attemptA < attemptB ? -1 : 1;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
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
