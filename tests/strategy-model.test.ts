/**
 * The strategy tier must actually be used — and must never overrun the function.
 *
 * TWO OUTAGES ARE PINNED HERE, and they pull in opposite directions.
 *
 * The first: lib/llm skips the top-tier planner when the budget is too small
 * for it to finish. That guard is correct, but every automated caller passed
 * 120_000ms against a 180_000ms threshold, so 100% of cron-built plans silently
 * ran on the cheap workhorse. Nothing failed and nothing logged.
 *
 * The second (2026-08-01): the fix for the first gave Opus a 240s cap, then
 * handed the FALLBACK a fresh 240s on failure — 480s inside a 300s function.
 * When Opus timed out instead of failing fast, Vercel killed the invocation
 * mid-fallback. A hard function timeout is uncatchable, so the route's
 * try/catch never ran: the cron fired hourly, wrote nothing, logged nothing,
 * and the platform reached mid-morning on the 1st with no plan for any domain
 * and no posts, because July's slots had all been consumed by the 30th.
 *
 * So the budget must be big enough to reach Opus AND small enough that the
 * whole ladder plus the write-back fits. splitStrategyBudget is the arithmetic
 * that satisfies both, and it is pure precisely so these cases don't need a
 * clock, a network, or a 300-second wait to prove.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Models handed to Replicate, in order — lets a test watch the ladder walk. */
const models: string[] = [];
/** Flipped by a test that wants the first (Opus) attempt to fail. */
let failFirstCall = false;

vi.mock('replicate', () => ({
  default: class {
    predictions = {
      create: async ({ model }: { model: string }) => {
        models.push(model);
        return { id: `pred_${models.length}`, status: 'starting', model };
      },
      cancel: async () => {},
    };
    wait = async (p: { model: string }) => {
      if (failFirstCall && models.length === 1) throw new Error('opus timeout');
      return { status: 'succeeded', output: '{"ok":true}', model: p.model };
    };
    run = async () => ['{"ok":true}'];
  },
}));

beforeEach(() => { models.length = 0; failFirstCall = false; });
afterEach(() => { vi.restoreAllMocks(); });

/** lib/llm's private threshold — below this, Opus can't land and is skipped. */
const MIN_OPUS_MS = 180_000;
/** Every strategy route declares maxDuration = 300. */
const FUNCTION_CEILING_MS = 300_000;

describe('splitStrategyBudget', () => {
  it('never hands out more time than the invocation has', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // THE INVARIANT THE OUTAGE VIOLATED. Whatever the total, the two attempts
    // together must leave room to persist the plan — otherwise the function is
    // killed between generating and writing, which costs a top-tier call and
    // produces exactly nothing.
    for (const total of [0, 1_000, 60_000, 120_000, 240_000, 300_000, 600_000]) {
      const { primaryMs, fallbackMs } = splitStrategyBudget(total);
      expect(primaryMs).toBeGreaterThanOrEqual(0);
      expect(fallbackMs).toBeGreaterThanOrEqual(0);
      expect(primaryMs + fallbackMs).toBeLessThanOrEqual(total);
    }
  });

  it('reaches Opus inside a real 300s function', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // The other half of the vice: if the split gets so conservative that Opus
    // is never attempted, we are back to 100% of plans on the workhorse.
    const { primaryMs } = splitStrategyBudget(FUNCTION_CEILING_MS);
    expect(primaryMs).toBeGreaterThanOrEqual(MIN_OPUS_MS);
  });

  it('always leaves the fallback something to spend', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // The fallback is the guarantee that a plan LANDS. It is reserved before
    // Opus is offered anything, so no Opus budget can starve it.
    for (const total of [120_000, 240_000, 300_000, 600_000]) {
      expect(splitStrategyBudget(total).fallbackMs).toBeGreaterThan(0);
    }
  });

  it('spends everything on the workhorse when Opus cannot land', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // A doomed Opus call helps nobody: burning 180s to time out and then
    // falling back is strictly worse than going straight to a model that
    // finishes. 120s is the budget every automated caller used to pass.
    const { primaryMs, fallbackMs } = splitStrategyBudget(120_000);
    expect(primaryMs).toBe(0);
    expect(fallbackMs).toBeGreaterThan(0);
  });

  it('cannot regress to the 240+240 ladder that blew the ceiling', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // The literal shape of the bug: two full-fat attempts inside one 300s
    // function. 240 + 240 = 480 > 300.
    const { primaryMs, fallbackMs } = splitStrategyBudget(FUNCTION_CEILING_MS);
    expect(primaryMs + fallbackMs).toBeLessThan(FUNCTION_CEILING_MS);
  });

  it('does not go negative on a budget already spent', async () => {
    const { splitStrategyBudget } = await import('../lib/llm');

    // ensureMonthlyStrategy subtracts elapsed DB time before calling down, so a
    // slow month-summary can hand this a very small or negative number.
    for (const total of [-50_000, 0, 5_000]) {
      const { primaryMs, fallbackMs } = splitStrategyBudget(total);
      expect(primaryMs).toBe(0);
      expect(fallbackMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('STRATEGY_BUDGET_MS', () => {
  it('caps the Opus attempt above the threshold that skips it', async () => {
    const { STRATEGY_BUDGET_MS } = await import('../lib/llm');
    expect(STRATEGY_BUDGET_MS).toBeGreaterThanOrEqual(MIN_OPUS_MS);
  });

  it('leaves room under the function ceiling for the fallback and the write', async () => {
    const { STRATEGY_BUDGET_MS } = await import('../lib/llm');
    expect(STRATEGY_BUDGET_MS).toBeLessThan(FUNCTION_CEILING_MS);
  });
});

describe('strategyLlmCall reporting', () => {
  it('reports which model answered and whether it fell back', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    const res = await strategyLlmCall({ system: 's', user: 'u', budgetMs: FUNCTION_CEILING_MS });

    expect(res.text).toBeTruthy();
    expect(res.model.length).toBeGreaterThan(0);
    expect(typeof res.fellBack).toBe('boolean');
  });

  it('does not report a fallback when the planner is given a whole function', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    const res = await strategyLlmCall({ system: 's', user: 'u', budgetMs: FUNCTION_CEILING_MS });

    expect(res.fellBack).toBe(false);
    expect(models).toHaveLength(1);
  });

  it('flags a fallback when the caller under-budgets the planner', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    // 120s — the budget every automated caller used to pass.
    const res = await strategyLlmCall({ system: 's', user: 'u', budgetMs: 120_000 });

    // The call still succeeds; what changed is that it now SAYS it was demoted
    // instead of looking identical to a real strategy build.
    expect(res.fellBack).toBe(true);
    expect(models).toHaveLength(1);
  });

  it('still answers on the workhorse when Opus fails mid-ladder', async () => {
    const { strategyLlmCall } = await import('../lib/llm');
    failFirstCall = true;

    const res = await strategyLlmCall({ system: 's', user: 'u', budgetMs: FUNCTION_CEILING_MS });

    // Both rungs ran, and the reserved fallback time is what made the second
    // one possible rather than a call the function ceiling cuts short.
    expect(models).toHaveLength(2);
    expect(res.fellBack).toBe(true);
    expect(res.text).toBeTruthy();
  });
});
