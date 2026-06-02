/**
 * Replicate-hosted LLM client. Defaults to google/gemini-3.1-pro.
 *
 * Note: Replicate's wrapper is plain text-in/text-out — there's no equivalent
 * of Google AI Studio's googleSearch tool. So research/writer agents rely on
 * model training data only. The validator will flag drafts lacking inline
 * citations; those land in the review queue for human editing.
 */
import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
export const MODEL = (process.env.REPLICATE_MODEL ?? 'google/gemini-3.1-pro') as `${string}/${string}`;

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<{ text: string }> {
  // Compose a single prompt — most Replicate text models accept system + user
  // in the `prompt` field. google/gemini-3.1-pro also accepts `system_prompt`.
  const input: Record<string, unknown> = {
    prompt: opts.user,
    system_prompt: opts.system,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: 0.7,
  };

  // replicate.run streams the model and returns the final aggregated output.
  // For text models this is typically an array of string chunks; join them.
  const output = await replicate.run(MODEL, { input });
  let text = '';
  if (Array.isArray(output)) text = (output as unknown[]).map(String).join('');
  else if (typeof output === 'string') text = output;
  else if (output && typeof (output as any)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of output as AsyncIterable<unknown>) text += String(chunk);
  } else {
    text = String(output ?? '');
  }
  return { text };
}
