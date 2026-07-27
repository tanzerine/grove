/**
 * Replicate via predictions.create() + wait() — NOT streaming.
 *
 * Streaming was duplicating output (each event re-emitted cumulative text
 * sometimes, plus our concat could double-count). The non-streaming path is
 * bulletproof: create the prediction, poll until done, take .output once.
 */
import Replicate from 'replicate';
import { record } from './cost-meter';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const MODEL = (process.env.REPLICATE_MODEL ?? 'google/gemini-3.1-pro') as `${string}/${string}`;

/** What one call spent. Nulls mean "the provider didn't say", not "zero". */
export type LlmUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  predictTimeMs: number | null;
  /** True when token counts were derived from length, not reported. */
  estimated?: boolean;
};

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  fast?: boolean;
  json?: boolean;
  model?: `${string}/${string}`;
  timeoutMs?: number;
}): Promise<{ text: string; usage: LlmUsage }> {
  const input: Record<string, unknown> = {
    prompt: opts.user,
    system_prompt: opts.system,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: 0.6,
  };

  // Hard 120s ceiling per call. Without this, Vercel's parent function can
  // hang past 300s if Replicate stalls, leaving posts stuck in 'writing'.
  const TIMEOUT_MS = opts.timeoutMs ?? 120_000;

  const prediction = await replicate.predictions.create({
    model: opts.model ?? MODEL,
    input,
    stream: false,
  } as any);

  let finished: any;
  try {
    finished = await Promise.race([
      replicate.wait(prediction, { interval: 1000 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Replicate timeout after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    // best-effort cancel so we don't keep paying for orphaned predictions
    replicate.predictions.cancel(prediction.id).catch(() => {});
    throw err;
  }

  if (finished.status !== 'succeeded') {
    throw new Error(`Replicate prediction ${finished.status}: ${finished.error ?? 'unknown'}`);
  }
  const out = finished.output;
  const text = Array.isArray(out) ? out.join('') : String(out ?? '');
  if (!text.trim()) throw new Error('Replicate returned empty output');
  const usage = usageFrom(finished, opts.model ?? MODEL, {
    promptChars: (opts.system?.length ?? 0) + (opts.user?.length ?? 0),
    outputChars: text.length,
  });
  // Report into the ambient meter, if the caller opened one. This is why the
  // pipeline's six LLM-spending modules need no signature change to be costed.
  record(usage);
  return { text, usage };
}

/**
 * Token counts for one call.
 *
 * Preferred source is Replicate's `metrics`, read defensively because field
 * names vary by model family. But the first production run showed the workhorse
 * (google/gemini-3.1-pro) reporting no token counts at all —
 *
 *     cost · $0.0000 · 5 calls · 0 in / 0 out · 5 unpriced
 *
 * — so every generation was correctly flagged unpriced and told us nothing.
 * "Honest and useless" is still useless when the whole point is to price the
 * plans.
 *
 * So when the provider stays silent we ESTIMATE from character count, and mark
 * the call `estimated` so the two can never be confused. ~4 chars/token is
 * crude and runs maybe ±25% on English prose, but a figure that's roughly right
 * answers "is Agency's margin thin?" and a null answers nothing. Everything
 * downstream carries the marker through to the log line, which renders `~$0.02`
 * rather than `$0.02`.
 */
const CHARS_PER_TOKEN = 4;

function usageFrom(
  finished: any,
  model: string,
  fallback: { promptChars: number; outputChars: number },
): LlmUsage {
  const m = finished?.metrics ?? {};
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    return null;
  };

  const reportedIn = pick('input_token_count', 'input_tokens', 'prompt_token_count');
  const reportedOut = pick('output_token_count', 'output_tokens', 'completion_token_count');
  const measured = reportedIn !== null || reportedOut !== null;

  // One-time visibility into what this model actually reports, so the key names
  // above can be corrected instead of guessed at again.
  if (!measured && !loggedMetricShape.has(model)) {
    loggedMetricShape.add(model);
    console.warn(`[llm] ${model} reported no token counts; metrics keys: ${Object.keys(m).join(', ') || '(none)'} — estimating from length`);
  }

  return {
    model,
    inputTokens: measured ? reportedIn : Math.ceil(fallback.promptChars / CHARS_PER_TOKEN),
    outputTokens: measured ? reportedOut : Math.ceil(fallback.outputChars / CHARS_PER_TOKEN),
    predictTimeMs: typeof m.predict_time === 'number' ? Math.round(m.predict_time * 1000) : null,
    estimated: !measured,
  };
}

/** Models we've already warned about, so the log isn't spammed every call. */
const loggedMetricShape = new Set<string>();

/* ─────────────── strategy LLM call (most capable model, rare) ──────────── */
// Planning is the highest-leverage LLM step in the loop — a bad plan wastes a
// whole month of generation spend — so it runs on Claude Opus 4.7. Cost stays
// reasonable for the business model because this tier is invoked at most a
// handful of times per domain per month: one monthly build plus a capped
// number of owner-requested plan revisions (see /api/strategy/chat). Everyday
// chat questions never reach this model. At ~3k input / ~4.5k output tokens a
// call is well under a dollar; ≤7 calls/domain/month keeps it a rounding error
// next to article generation.

const STRATEGY_MODEL = (
  process.env.REPLICATE_STRATEGY_MODEL ?? 'anthropic/claude-opus-4.7'
) as `${string}/${string}`;

// Opus needs real wall-clock time to finish (~3-4 min for a full plan). When
// the caller's budget is too tight for it to complete, attempting Opus just
// burns that budget timing out before we fall back to the workhorse anyway — so
// below this threshold we skip it and go straight to the workhorse.
//
// THE TRAP THIS SET. Every automated caller passed 120_000 — the monthly cron's
// LLM_TIMEOUT_MS and the scheduler's healBudgetMs — which is below the
// threshold. So 100% of automated strategy builds silently ran on the cheap
// workhorse, and the only path that ever reached Opus was an interactive plan
// revision. The product's most expensive promise was switched off by an
// inequality, with no signal anywhere: no log line, no column, nothing.
//
// The threshold is still right — a doomed call helps nobody. What was wrong was
// the callers. Strategy now runs on its own cron with the whole invocation to
// itself (see /api/cron/strategy), so it can pass a budget Opus can actually
// land in. `planned_by` on the result records which model really ran, so this
// can never again be invisible.
const STRATEGY_MIN_BUDGET_MS = 180_000;

/** What a strategy call needs, so callers can't accidentally under-budget it. */
export const STRATEGY_BUDGET_MS = 240_000;

export type StrategyCallResult = {
  text: string;
  /** The model that actually produced this text — Opus, or the fallback. */
  model: string;
  /** True when the top tier was skipped or failed and the workhorse answered. */
  fellBack: boolean;
};

export async function strategyLlmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;   // callers on a tight function budget (crons) pass a lower cap
}): Promise<StrategyCallResult> {
  const timeoutMs = opts.timeoutMs ?? STRATEGY_BUDGET_MS;
  const maxTokens = opts.maxTokens ?? 4500;

  if (timeoutMs < STRATEGY_MIN_BUDGET_MS) {
    // Not enough time for Opus to finish — don't waste the call. Loud, because
    // this silently disabled the strategy tier for months.
    console.warn(
      `[strategyLlmCall] budget ${timeoutMs}ms < ${STRATEGY_MIN_BUDGET_MS}ms — ` +
      `skipping ${STRATEGY_MODEL}, planning on ${MODEL}`,
    );
    const { text } = await llmCall({ ...opts, maxTokens, timeoutMs });
    return { text, model: MODEL, fellBack: true };
  }

  try {
    const { text } = await llmCall({ ...opts, model: STRATEGY_MODEL, maxTokens, timeoutMs });
    return { text, model: STRATEGY_MODEL, fellBack: false };
  } catch (err) {
    // The loop must never stall on a single provider hiccup: fall back to the
    // workhorse model rather than leaving a domain without a plan.
    console.error('[strategyLlmCall] falling back to main model:', err);
    const { text } = await llmCall(opts);
    return { text, model: MODEL, fellBack: true };
  }
}

/* ─────────────────── fast LLM call (small model, low latency) ──────────── */
// Uses Llama 3.2 3B — optimised for quick structured tasks like topic
// generation. Typically responds in 3–6s vs 15–60s for the main model.
// Falls back gracefully: caller should handle null return.

const FAST_MODEL = (
  process.env.REPLICATE_FAST_MODEL ?? 'meta/llama-3.2-3b-instruct'
) as `${string}/${string}`;

export async function fastLlmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ text: string }> {
  const out = await Promise.race([
    replicate.run(FAST_MODEL, {
      input: {
        prompt: opts.user,
        system_prompt: opts.system,
        max_tokens: opts.maxTokens ?? 512,
        temperature: 0.7,
      },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('fast LLM timeout')), 30_000)
    ),
  ]);

  const text = Array.isArray(out) ? (out as string[]).join('') : String(out ?? '');
  if (!text.trim()) throw new Error('fast LLM returned empty output');
  return { text };
}

/* ─────────────────────── defensive JSON extractor ─────────────────────── */

export function extractJson<T = unknown>(text: string): T {
  if (!text || !text.trim()) throw new Error('extractJson: empty response');
  const t = text.trim();

  // Candidate extractions, most-likely-correct first:
  //   1. the whole response wrapped in one fence (anchored — a ``` INSIDE a
  //      JSON string value, e.g. an article body with code blocks, must not
  //      be mistaken for the wrapper)
  //   2. outermost brace slice of the raw text (covers "Sure! {...}" chatter)
  //   3. legacy: first non-anchored fence, for chatter that itself contains braces
  const candidates: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const first = s.indexOf('{'); const last = s.lastIndexOf('}');
    if (first === -1 || last < first) return;
    const sliced = s.slice(first, last + 1);
    if (!candidates.includes(sliced)) candidates.push(sliced);
  };
  push(t.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i)?.[1]);
  push(t);
  push(t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]);
  if (!candidates.length) throw new Error(`extractJson: no JSON braces. Got: ${text.slice(0, 200)}…`);

  // Repair ladder — try the clean parse first and only mutate on failure.
  // Always-on "repairs" used to corrupt VALID output: typographic quotes in a
  // string value got globally flattened to '"' (breaking the JSON), and ```
  // inside a value (code blocks in article text) got stripped.
  const repairs: Array<(s: string) => string> = [
    (s) => s,
    (s) => escapeControlChars(s.replace(/,(\s*[}\]])/g, '$1')),
    (s) => escapeControlChars(
      s.replace(/```json/gi, '').replace(/```/g, '')
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/,(\s*[}\]])/g, '$1'),
    ),
  ];
  let lastErr: unknown;
  for (const candidate of candidates) {
    for (const repair of repairs) {
      try { return JSON.parse(repair(candidate)) as T; } catch (e) { lastErr = e; }
    }
  }
  throw new Error(`extractJson: ${(lastErr as any)?.message}. First 300: ${candidates[0].slice(0, 300)}…`);
}

function escapeControlChars(s: string): string {
  let out = ''; let inStr = false; let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { out += c; esc = false; continue; }
    if (inStr && c === '\\') { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr && c.charCodeAt(0) < 0x20) {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t'
           : c === '\b' ? '\\b' : c === '\f' ? '\\f'
           : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      continue;
    }
    out += c;
  }
  return out;
}
