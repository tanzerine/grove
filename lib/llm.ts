/**
 * Gemini wrapper (Google AI Studio).
 *
 * Two model tiers:
 *   - MODEL      → Pro, used for article writing (highest quality)
 *   - FAST_MODEL → Flash, used for cheap structured-extraction tasks (site profile)
 *
 * Tavily handles web search separately, so we deliberately do NOT pass the
 * googleSearch tool here — gives us tighter control over citations and avoids
 * surprise tool-use billing.
 */
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
export const gemini = new GoogleGenAI({ apiKey });

export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro';
export const FAST_MODEL = process.env.GEMINI_FAST_MODEL ?? 'gemini-2.5-flash';

export async function llmCall(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  fast?: boolean;       // use the cheap Flash model
  json?: boolean;       // ask for JSON-only output (we still parse defensively)
}): Promise<{ text: string }> {
  const model = opts.fast ? FAST_MODEL : MODEL;
  const response = await gemini.models.generateContent({
    model,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens ?? 4000,
      temperature: 0.7,
      ...(opts.json ? { responseMimeType: 'application/json' } : {}),
    },
  });
  return { text: response.text ?? '' };
}
