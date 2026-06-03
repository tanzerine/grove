/**
 * Replicate-hosted LLM wrapper. Defaults to google/gemini-3.1-pro.
 * Tavily handles search separately (lib/search.ts).
 *
 * IMPORTANT — stream filtering: Replicate's SSE stream emits multiple event
 * types (`output`, `logs`, `done`, `error`), all with a `.data` field. We MUST
 * only concatenate `output` events; including `logs` pollutes the text and
 * causes downstream JSON parse failures.
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
    temperature: 0.7,
  };

  let text = '';
  for await (const event of replicate.stream(MODEL, { input })) {
    const e: any = event;
    // Only output events carry model text. Logs/done/error are metadata.
    if (e?.event === 'output' && typeof e.data === 'string') {
      text += e.data;
    } else if (e?.event === 'error') {
      throw new Error(`Replicate stream error: ${String(e.data ?? 'unknown')}`);
    }
    // ignore: logs, done, ping, anything else
  }
  if (!text.trim()) throw new Error('Replicate returned empty output');
  return { text };
}

/* ─────────────────────── defensive JSON extractor ─────────────────────── */

export function extractJson<T = unknown>(text: string): T {
  if (!text || !text.trim()) throw new Error('extractJson: empty response');

  let c = text.trim();

  const fenced = c.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) c = fenced[1].trim();

  const first = c.indexOf('{');
  const last = c.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error(`extractJson: no JSON braces. Got: ${text.slice(0, 200)}…`);
  }
  c = c.slice(first, last + 1);
  c = c.replace(/```json/gi, '').replace(/```/g, '');
  c = c.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  try { return JSON.parse(c) as T; } catch (e: any) {
    let cleaned = c.replace(/,(\s*[}\]])/g, '$1');
    cleaned = escapeControlChars(cleaned);
    try { return JSON.parse(cleaned) as T; }
    catch (e2: any) {
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
