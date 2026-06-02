/**
 * Generic OpenAI-compatible LLM client. Defaults to Groq (free Llama 3.3 70B).
 *
 * Swap providers with env vars — no code change:
 *   - Groq:       LLM_BASE_URL=https://api.groq.com/openai/v1
 *   - OpenRouter: LLM_BASE_URL=https://openrouter.ai/api/v1
 *   - Together:   LLM_BASE_URL=https://api.together.xyz/v1
 *   - DeepSeek:   LLM_BASE_URL=https://api.deepseek.com/v1
 *   - OpenAI:     LLM_BASE_URL=https://api.openai.com/v1
 */
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY || 'placeholder',
  baseURL: process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
});

export const MODEL = process.env.LLM_MODEL ?? 'llama-3.3-70b-versatile';

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;     // request JSON-mode output if provider supports it
}): Promise<{ text: string }> {
  const res = await client.chat.completions.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    temperature: 0.7,
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.user },
    ],
    ...(opts.json ? { response_format: { type: 'json_object' as const } } : {}),
  });
  return { text: res.choices[0]?.message?.content ?? '' };
}
