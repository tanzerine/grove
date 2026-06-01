import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || '';
export const gemini = new GoogleGenAI({ apiKey });
export const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

/** Call Gemini with optional Google-Search grounding. Returns text plus any
 *  grounding sources (URL + title) the model used so we can ensure citations.
 */
export async function geminiCall(opts: {
  system: string;
  user: string;
  withSearch?: boolean;
  maxTokens?: number;
}): Promise<{ text: string; sources: { uri: string; title: string }[] }> {
  const response = await gemini.models.generateContent({
    model: MODEL,
    contents: opts.user,
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens ?? 4000,
      temperature: 0.7,
      ...(opts.withSearch ? { tools: [{ googleSearch: {} } as any] } : {}),
    },
  });

  const text = response.text ?? '';
  const grounding: any = response.candidates?.[0]?.groundingMetadata;
  const sources: { uri: string; title: string }[] = (grounding?.groundingChunks ?? [])
    .map((c: any) => c.web)
    .filter((w: any) => w?.uri)
    .map((w: any) => ({ uri: w.uri, title: w.title ?? w.uri }));

  return { text, sources };
}
