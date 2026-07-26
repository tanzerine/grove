/**
 * The strategy tier must actually be used.
 *
 * lib/llm skips the top-tier planner when the caller's budget is too small for
 * it to finish. That guard is correct — a doomed call helps nobody — but every
 * automated caller passed 120_000ms against a 180_000ms threshold, so 100% of
 * cron-built plans silently ran on the cheap workhorse. The only path that ever
 * reached the strategy model was an interactive plan revision.
 *
 * Nothing failed, nothing logged, and the product's most expensive promise was
 * off. These tests pin the two things that made it invisible: the budget every
 * automated caller passes, and the record of which model actually ran.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls: Array<{ model?: string; timeoutMs?: number }> = [];

vi.mock('replicate', () => ({
  default: class {
    predictions = {
      create: async () => ({ id: 'pred_1', status: 'starting' }),
      cancel: async () => {},
    };
    wait = async () => ({ status: 'succeeded', output: '{"ok":true}' });
    run = async () => ['{"ok":true}'];
  },
}));

beforeEach(() => { calls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('strategy budget', () => {
  it('gives the planner a budget above the threshold that skips it', async () => {
    const { STRATEGY_BUDGET_MS } = await import('../lib/llm');
    // The exported budget is what /api/cron/strategy passes. If it ever drops
    // below lib/llm's STRATEGY_MIN_BUDGET_MS (180s) the top tier is silently
    // skipped again — which is exactly the bug this constant exists to prevent.
    expect(STRATEGY_BUDGET_MS).toBeGreaterThanOrEqual(180_000);
  });

  it('leaves room under the 300s function ceiling for the response', async () => {
    const { STRATEGY_BUDGET_MS } = await import('../lib/llm');
    expect(STRATEGY_BUDGET_MS).toBeLessThan(300_000);
  });
});

describe('strategyLlmCall reporting', () => {
  it('reports which model answered and whether it fell back', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    const res = await strategyLlmCall({
      system: 's', user: 'u', timeoutMs: 240_000,
    });

    expect(res.text).toBeTruthy();
    expect(typeof res.model).toBe('string');
    expect(res.model.length).toBeGreaterThan(0);
    expect(typeof res.fellBack).toBe('boolean');
  });

  it('flags a fallback when the caller under-budgets the planner', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    // 120s — the budget every automated caller used to pass.
    const res = await strategyLlmCall({ system: 's', user: 'u', timeoutMs: 120_000 });

    // The call still succeeds; what changed is that it now SAYS it was demoted
    // instead of looking identical to a real strategy build.
    expect(res.fellBack).toBe(true);
  });

  it('does not report a fallback when the planner is given room', async () => {
    const { strategyLlmCall } = await import('../lib/llm');

    const res = await strategyLlmCall({ system: 's', user: 'u', timeoutMs: 240_000 });

    expect(res.fellBack).toBe(false);
  });
});
