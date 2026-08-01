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

/**
 * Pull the assistant text out of whatever shape a Replicate model returns.
 *
 * Output shape is per-model, not per-platform. The workhorse
 * (google/gemini-3.1-pro) streams an array of string chunks, which is all this
 * ever handled: `Array.isArray(out) ? out.join('') : String(out ?? '')`.
 *
 * THE OUTAGE THAT CAUSED THIS. The strategy tier is the only caller of
 * anthropic/claude-opus-4.7, and an Anthropic-shaped response is an OBJECT, not
 * an array of chunks. `String(object)` is the literal "[object Object]" — which
 * is non-empty, so the empty-output guard passed it, llmCall reported success,
 * and strategyLlmCall's fallback (which only fires on a throw) never engaged.
 * The failure surfaced two frames later as extractJson's "no JSON braces", so
 * every monthly plan build died after the model had already run and been
 * billed. `planned_by` was null on every strategy row in production because no
 * Opus build had EVER completed — the one diagnostic that would have shown it.
 *
 * Returns null when nothing usable is present, so the caller throws and the
 * fallback ladder does what it was written to do.
 */
export function textFromReplicateOutput(out: unknown): string | null {
  if (out == null) return null;
  if (typeof out === 'string') return out;
  if (typeof out === 'number' || typeof out === 'boolean') return String(out);

  // Streamed chunks — the workhorse's shape. Elements may themselves be
  // content blocks, so recurse rather than assuming strings.
  if (Array.isArray(out)) {
    const parts = out.map((p) => textFromReplicateOutput(p)).filter((s): s is string => !!s);
    return parts.length ? parts.join('') : null;
  }

  if (typeof out === 'object') {
    const o = out as Record<string, unknown>;
    // Anthropic message content: [{ type: 'text', text: '...' }, ...]
    if (Array.isArray(o.content)) {
      const joined = textFromReplicateOutput(o.content);
      if (joined) return joined;
    }
    // A single content block, or the common single-field wrappers.
    for (const key of ['text', 'completion', 'output', 'message', 'response']) {
      const v = o[key];
      if (v != null && v !== out) {
        const s = textFromReplicateOutput(v);
        if (s) return s;
      }
    }
  }
  return null;
}

/** Shape summary for error messages — never the content, which can be huge. */
export function describeOutputShape(out: unknown): string {
  if (out === null) return 'null';
  if (out === undefined) return 'undefined';
  if (Array.isArray(out)) return `array(${out.length})[${out.length ? typeof out[0] : ''}]`;
  if (typeof out === 'object') return `object{${Object.keys(out as object).join(',') || 'no keys'}}`;
  return typeof out;
}

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
  const text = textFromReplicateOutput(finished.output);
  if (!text || !text.trim()) {
    // THROW, don't return junk. `String(out)` on an object yields the literal
    // "[object Object]" — non-empty, so the old guard passed it through as if
    // the call had succeeded. strategyLlmCall's fallback only triggers on a
    // thrown error, so a shape it didn't understand bypassed the safety net
    // entirely and the failure surfaced two frames later as extractJson's
    // "no JSON braces", with the model already billed. Failing here is what
    // lets the fallback do its job.
    throw new Error(
      `Replicate returned unusable output from ${opts.model ?? MODEL} ` +
      `(shape: ${describeOutputShape(finished.output)})`,
    );
  }
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

/** Cap on the Opus attempt. More than this buys nothing and costs latency. */
export const STRATEGY_BUDGET_MS = 240_000;

/**
 * Wall clock the fallback is GUARANTEED, carved out before Opus is offered
 * anything.
 *
 * THE OUTAGE THIS EXISTS TO PREVENT. The ladder used to hand the fallback a
 * *fresh* full `timeoutMs` — the same 240s Opus had just spent — with no
 * deadline arithmetic anywhere:
 *
 *     const { text } = await llmCall({ ...opts, model: STRATEGY_MODEL, timeoutMs }); // 240s
 *     } catch { const { text } = await llmCall(opts); }                              // 240s AGAIN
 *
 * 240 + 240 = 480s against a route whose `maxDuration` is 300. So whenever Opus
 * timed out rather than failing fast, the fallback started at ~245s and Vercel
 * killed the function mid-call. A hard function timeout is NOT catchable: the
 * route's try/catch never ran, nothing was written, nothing was logged. The
 * cron fired hourly, did that, and reported nothing — which is exactly how
 * 2026-08-01 reached mid-morning with zero August plans and zero posts on a
 * platform whose July slots had all been consumed by the 30th.
 *
 * The workhorse only needs a fraction of Opus's time for the same prompt, so
 * reserving this is cheap insurance: the plan lands on the workhorse instead of
 * not landing at all.
 */
const STRATEGY_FALLBACK_RESERVE_MS = 75_000;

/**
 * Time held back from the LLM ladder so the finished plan can be WRITTEN.
 *
 * Generating a plan and then being killed before the INSERT is the same outcome
 * as never generating it, but costs a top-tier call. The persistence path after
 * buildStrategy returns (deactivate, insert, savePlanContext, captureServer) is
 * several round trips.
 */
const STRATEGY_WRITEBACK_RESERVE_MS = 20_000;

export type StrategyBudget = {
  /** Wall clock for the Opus attempt; 0 when it must be skipped entirely. */
  primaryMs: number;
  /** Wall clock left for the workhorse. Never 0 for a usable total. */
  fallbackMs: number;
};

/**
 * Split one invocation's remaining wall clock across the model ladder.
 *
 * Ordering is the whole design: the fallback is reserved FIRST and Opus is
 * offered only what survives that. The guarantee it buys — the property the
 * old code lacked — is `primaryMs + fallbackMs + writeback <= totalMs`, so the
 * ladder can never overrun the function ceiling and die uncatchably.
 *
 * When what's left for Opus is under the threshold it could actually finish in,
 * Opus is skipped and its share goes to the workhorse: a doomed call helps
 * nobody, and spending the whole budget on a model that will finish is strictly
 * better than spending most of it on one that won't.
 *
 * Pure, so the arithmetic that caused a platform-wide outage is unit-testable
 * without a clock, a network, or a 300-second wait.
 */
export function splitStrategyBudget(totalMs: number): StrategyBudget {
  const usable = Math.max(0, Math.floor(totalMs) - STRATEGY_WRITEBACK_RESERVE_MS);

  // Reserve the fallback before Opus is considered at all.
  const reserved = Math.min(STRATEGY_FALLBACK_RESERVE_MS, usable);
  const primaryMs = Math.min(STRATEGY_BUDGET_MS, usable - reserved);

  // Not enough left for Opus to land — give the workhorse everything.
  if (primaryMs < STRATEGY_MIN_BUDGET_MS) return { primaryMs: 0, fallbackMs: usable };

  return { primaryMs, fallbackMs: usable - primaryMs };
}

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
  /**
   * Wall clock for the WHOLE ladder — both attempts plus write-back headroom —
   * not the cap for a single call. Callers pass what their invocation actually
   * has left, so this function can never hand out more time than exists.
   */
  budgetMs?: number;
}): Promise<StrategyCallResult> {
  const maxTokens = opts.maxTokens ?? 4500;
  // Default to a full Vercel function; every strategy route declares 300s.
  const { primaryMs, fallbackMs } = splitStrategyBudget(opts.budgetMs ?? 300_000);

  if (primaryMs > 0) {
    try {
      const { text } = await llmCall({ ...opts, model: STRATEGY_MODEL, maxTokens, timeoutMs: primaryMs });
      return { text, model: STRATEGY_MODEL, fellBack: false };
    } catch (err) {
      // The loop must never stall on a single provider hiccup: fall back to the
      // workhorse rather than leaving a domain without a plan. The fallback's
      // time was reserved up front, so it is still there to spend.
      console.error('[strategyLlmCall] falling back to main model:', err);
    }
  } else {
    // Loud, because an under-budgeted ladder silently disabled the strategy
    // tier for months.
    console.warn(
      `[strategyLlmCall] budget ${opts.budgetMs}ms leaves < ${STRATEGY_MIN_BUDGET_MS}ms ` +
      `for ${STRATEGY_MODEL} — planning on ${MODEL}`,
    );
  }

  const { text } = await llmCall({ ...opts, maxTokens, timeoutMs: fallbackMs });
  return { text, model: MODEL, fellBack: true };
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
    // Last resort: the model ran out of output tokens mid-document. Salvaging
    // the complete part beats throwing away everything it wrote — see
    // closeTruncatedJson.
    (s) => closeTruncatedJson(s),
    (s) => closeTruncatedJson(escapeControlChars(s.replace(/,(\s*[}\]])/g, '$1'))),
  ];
  let lastErr: unknown;
  for (const candidate of candidates) {
    for (const repair of repairs) {
      try { return JSON.parse(repair(candidate)) as T; } catch (e) { lastErr = e; }
    }
  }
  throw new Error(`extractJson: ${(lastErr as any)?.message}. First 300: ${candidates[0].slice(0, 300)}…`);
}

/**
 * Close a JSON document the model stopped writing halfway through, by dropping
 * the incomplete tail and closing whatever containers are still open.
 *
 * WHY. `max_tokens` is a guillotine: the model emits perfectly good JSON right
 * up to the ceiling and then simply stops, usually mid-array. V8 reports that
 * as "Expected ',' or ']' after array element at position N", which reads like
 * malformed output but is really "there was more and you didn't pay for it".
 *
 * On 2026-08-01 that killed www.oveners.com's August plan on every tick: a
 * 13-slot calendar didn't fit in 4500 tokens, so ~10.4KB of usable strategy —
 * goals, KPIs, pillars, and most of the calendar — was thrown away because the
 * last slot was half-written. A month with ten planned articles is worth
 * enormously more than no month at all, and normalizeStrategy already repairs
 * a short plan: it backfills dangling references, dedupes, and re-dates every
 * slot it kept.
 *
 * The cut point is the only one that is provably legal: immediately after a
 * nested value closes, its container is between elements, so appending the
 * open brackets in reverse always yields parseable JSON. A partial trailing
 * element is discarded rather than guessed at — this never invents content,
 * it only stops short.
 *
 * Returns the input unchanged when nothing is open (not truncated) or when
 * there's no complete nested value to cut back to, so the caller still throws.
 */
export function closeTruncatedJson(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let stackAtCut: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') {
      stack.pop();
      // Only inside an enclosing container: a close at depth 0 ends the whole
      // document, which means it was never truncated in the first place.
      if (stack.length) { cut = i + 1; stackAtCut = [...stack]; }
    }
  }

  if (!stack.length || cut === -1) return s;

  let out = s.slice(0, cut);
  for (let i = stackAtCut.length - 1; i >= 0; i--) out += stackAtCut[i] === '{' ? '}' : ']';
  return out;
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
