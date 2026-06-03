/**
 * Replicate-hosted LLM wrapper. Defaults to google/gemini-3.1-pro.
 *
 * Replicate is a single text-in / text-out wrapper — no built-in web search,
 * no tool use. We pair it with Tavily for citations (lib/search.ts).
 */
import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const MODEL = (process.env.REPLICATE_MODEL ?? 'google/gemini-3.1-pro') as `${string}/${string}`;

/**
 * Defensive JSON extractor for LLM responses.
 *
 * Models frequently:
 *  - Wrap output in ```json fences
 *  - Add preamble/postamble like "Here is your JSON:"
 *  - Nest extra code fences inside string values (Replicate's Gemini does this)
 *  - Use smart quotes instead of straight quotes
 *
 * Tries hard to recover. Throws with a context snippet if it can't.
 */
export function extractJson<T = unknown>(text: string): T {
  if (!text || !text.trim()) throw new Error('extractJson: empty response');

  let candidate = text.trim();

  // 1) strip outer ```json ... ``` fence if present
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();

  // 2) find outermost { ... } block
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error(`extractJson: no JSON braces found in: ${text.slice(0, 200)}…`);
  }
  candidate = candidate.slice(first, last + 1);

  // 3) strip any nested ```json or ``` markers that aren't real fences
  candidate = candidate.replace(/```json/gi, '').replace(/```/g, '');

  // 4) normalize smart quotes
  candidate = candidate.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

  try {
    return JSON.parse(candidate) as T;
  } catch (e: any) {
    // 5) strip trailing commas before } or ]
    let cleaned = candidate.replace(/,(\s*[}\]])/g, '$1');
    // 6) escape unescaped control characters inside string values
    cleaned = escapeControlCharsInStrings(cleaned);
    try {
      return JSON.parse(cleaned) as T;
    } catch (e2: any) {
      throw new Error(`extractJson: parse failed: ${e2?.message ?? e?.message}. First 300 chars: ${cleaned.slice(0, 300)}…`);
    }
  }
}

/**
 * Walks the string in single pass tracking quote state, escapes raw control
 * characters only inside JSON string values. Handles \" within strings too.
 */
function escapeControlCharsInStrings(s: string): string {
  let out = '';
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escapeNext) { out += c; escapeNext = false; continue; }
    if (inString && c === '\\') { out += c; escapeNext = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString && c.charCodeAt(0) < 0x20) {
      if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c === '\b') out += '\\b';
      else if (c === '\f') out += '\\f';
      else out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
      continue;
    }
    out += c;
  }
  return out;
}

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  fast?: boolean;  // accepted for API compatibility; same model under the hood on Replicate
  json?: boolean;  // accepted but enforced via prompt, not provider flag
}): Promise<{ text: string }> {
  const input: Record<string, unknown> = {
    prompt: opts.user,
    system_prompt: opts.system,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: 0.7,
  };

  // Use streaming to support long outputs (Replicate's `run` can time out on big responses).
  let text = '';
  for await (const event of replicate.stream(MODEL, { input })) {
    // event from Replicate stream is a ServerSentEvent — text payload on .data for "output" events
    const chunk: any = event;
    if (chunk?.event === 'output' || chunk?.data) text += String(chunk.data ?? '');
    else if (typeof chunk === 'string') text += chunk;
  }
  return { text };
}
