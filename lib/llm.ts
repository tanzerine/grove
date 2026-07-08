/**
 * Replicate via predictions.create() + wait() — NOT streaming.
 *
 * Streaming was duplicating output (each event re-emitted cumulative text
 * sometimes, plus our concat could double-count). The non-streaming path is
 * bulletproof: create the prediction, poll until done, take .output once.
 */
import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const MODEL = (process.env.REPLICATE_MODEL ?? 'google/gemini-3.1-pro') as `${string}/${string}`;

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  fast?: boolean;
  json?: boolean;
  model?: `${string}/${string}`;
  timeoutMs?: number;
}): Promise<{ text: string }> {
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
  return { text };
}

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
// the caller's budget is too tight for it to complete — the crons run on a
// ~120s/domain slice under Vercel's 300s ceiling — attempting Opus just burns
// the whole budget timing out before we fall back to the workhorse anyway. So
// below this threshold we skip Opus entirely and go straight to the workhorse:
// same result the timeout+fallback produced, but ~2 min faster and without
// spending a doomed (and billed) Opus prediction on every single build. Opus
// still runs where it can actually land (interactive plan revisions, 240s).
const STRATEGY_MIN_BUDGET_MS = 180_000;

export async function strategyLlmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;   // callers on a tight function budget (crons) pass a lower cap
}): Promise<{ text: string }> {
  const timeoutMs = opts.timeoutMs ?? 240_000;   // Opus is slower; default fits an interactive call
  const maxTokens = opts.maxTokens ?? 4500;

  if (timeoutMs < STRATEGY_MIN_BUDGET_MS) {
    // Not enough time for Opus to finish — don't waste the call, just use the
    // workhorse directly.
    return llmCall({ ...opts, maxTokens, timeoutMs });
  }

  try {
    return await llmCall({ ...opts, model: STRATEGY_MODEL, maxTokens, timeoutMs });
  } catch (err) {
    // The loop must never stall on a single provider hiccup: fall back to the
    // workhorse model rather than leaving a domain without a plan.
    console.error('[strategyLlmCall] falling back to main model:', err);
    return llmCall(opts);
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
