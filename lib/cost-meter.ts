/**
 * Per-run LLM spend meter.
 *
 * Cost is cross-cutting: a generation spends across site-profile, topic-refiner,
 * writer (often twice), manager (often twice), cover art-direction and inline
 * images — six modules that have nothing to do with billing. Threading a usage
 * value out of each one would mean changing six return types, their callers and
 * their tests, and coupling the whole pipeline to a concern none of it owns.
 *
 * So llmCall reports into an AsyncLocalStorage meter instead, and whoever starts
 * a run opens one. Nothing in between has to know. Outside a metered scope
 * `record` is a no-op, so ad-hoc callers (the assistant, plan chat) cost
 * nothing and break nothing.
 *
 * AsyncLocalStorage rather than a module-level array specifically because ticks
 * can overlap: a plain global would bill one post for another's tokens.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { llmCostUsd, type LlmUsage } from './cost';

export type MeteredCall = LlmUsage & { costUsd: number | null };

const store = new AsyncLocalStorage<MeteredCall[]>();

/** Run `fn` with a fresh meter; returns its result and everything it spent. */
export async function runMetered<T>(fn: () => Promise<T>): Promise<{ result: T; calls: MeteredCall[] }> {
  const calls: MeteredCall[] = [];
  const result = await store.run(calls, fn);
  return { result, calls };
}

/** Record one call's usage. No-op outside a metered scope. */
export function record(usage: LlmUsage): void {
  const calls = store.getStore();
  if (!calls) return;
  calls.push({ ...usage, costUsd: llmCostUsd(usage) });
}

export type RunCost = {
  /** USD across every call we could price. */
  totalUsd: number;
  calls: number;
  /** Calls whose model isn't in the price table, or that reported no tokens. */
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
  /** Spend per model, so the expensive tier is obvious at a glance. */
  byModel: Record<string, number>;
};

export function summarize(calls: readonly MeteredCall[]): RunCost {
  const out: RunCost = { totalUsd: 0, calls: 0, unpriced: 0, inputTokens: 0, outputTokens: 0, byModel: {} };
  for (const c of calls) {
    out.calls++;
    out.inputTokens += Number(c.inputTokens ?? 0);
    out.outputTokens += Number(c.outputTokens ?? 0);
    if (typeof c.costUsd === 'number' && Number.isFinite(c.costUsd)) {
      out.totalUsd += c.costUsd;
      out.byModel[c.model] = (out.byModel[c.model] ?? 0) + c.costUsd;
    } else {
      // Counted, never folded in as zero — an unpriced call must not make a
      // total look cheaper than it was.
      out.unpriced++;
    }
  }
  out.totalUsd = Math.round(out.totalUsd * 1e6) / 1e6;
  for (const k of Object.keys(out.byModel)) out.byModel[k] = Math.round(out.byModel[k] * 1e6) / 1e6;
  return out;
}

/** One-line summary for the pipeline log: "$0.0182 · 6 calls · 14.2k in / 5.1k out". */
export function describeCost(c: RunCost): string {
  const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const parts = [
    `$${c.totalUsd.toFixed(4)}`,
    `${c.calls} call${c.calls === 1 ? '' : 's'}`,
    `${tok(c.inputTokens)} in / ${tok(c.outputTokens)} out`,
  ];
  if (c.unpriced) parts.push(`${c.unpriced} unpriced`);
  return parts.join(' · ');
}
