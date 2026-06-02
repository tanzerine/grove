/**
 * Replicate-hosted LLM wrapper. Defaults to google/gemini-3.1-pro.
 *
 * Replicate is a single text-in / text-out wrapper — no built-in web search,
 * no tool use. We pair it with Tavily for citations (lib/search.ts).
 */
import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export const MODEL = (process.env.REPLICATE_MODEL ?? 'google/gemini-3.1-pro') as `${string}/${string}`;

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
