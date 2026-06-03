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
}): Promise<{ text: string }> {
  const input: Record<string, unknown> = {
    prompt: opts.user,
    system_prompt: opts.system,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: 0.6,
  };

  // Hard 120s ceiling per call. Without this, Vercel's parent function can
  // hang past 300s if Replicate stalls, leaving posts stuck in 'writing'.
  const TIMEOUT_MS = 120_000;

  const prediction = await replicate.predictions.create({
    model: MODEL,
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

/* ─────────────────────── defensive JSON extractor ─────────────────────── */

export function extractJson<T = unknown>(text: string): T {
  if (!text || !text.trim()) throw new Error('extractJson: empty response');
  let c = text.trim();
  const fenced = c.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) c = fenced[1].trim();
  const first = c.indexOf('{'); const last = c.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) throw new Error(`extractJson: no JSON braces. Got: ${text.slice(0, 200)}…`);
  c = c.slice(first, last + 1).replace(/```json/gi, '').replace(/```/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  try { return JSON.parse(c) as T; } catch (e: any) {
    let cleaned = c.replace(/,(\s*[}\]])/g, '$1');
    cleaned = escapeControlChars(cleaned);
    try { return JSON.parse(cleaned) as T; } catch (e2: any) {
      throw new Error(`extractJson: ${e2?.message ?? e?.message}. First 300: ${cleaned.slice(0, 300)}…`);
    }
  }
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
