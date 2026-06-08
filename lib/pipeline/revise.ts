/**
 * Rewrite ONE selected passage of an article on demand, in the brand voice.
 * Powers the editor's "Revise with AI" selection action. Bounded: one short
 * LLM call per revision, only the selected text is rewritten.
 */
import { llmCall } from '../llm';
import type { SiteProfile } from './site-profile';

export async function reviseSection(opts: {
  selected: string;
  instruction: string;
  context?: string;
  profile?: SiteProfile | null;
}): Promise<string> {
  const { selected, instruction, context = '', profile } = opts;
  const business = profile?.business;
  const voice = profile?.voice;

  const system = `You are an editor revising ONE passage inside an existing article.
Rewrite ONLY the selected passage, following the user's instruction, keeping it
consistent with the surrounding article and the brand voice.

${business ? `BUSINESS: ${business.name} — ${business.description}\nAUDIENCE: ${business.target_audience}` : ''}
${voice ? `VOICE: ${voice.persona}. ${voice.tone}.${voice.we_are?.length ? ' We are: ' + voice.we_are.join('; ') + '.' : ''}${voice.avoid?.length ? ' Never say: ' + voice.avoid.join(', ') + '.' : ''}` : ''}

RULES
- Return ONLY the revised passage — no preamble, no quotation marks, no code fences, no explanation.
- Keep roughly the same length unless the instruction asks otherwise.
- Match the surrounding prose style. Don't add headings or list syntax unless the original passage had them.
- Don't invent statistics, quotes, or citations.`;

  const user = `ARTICLE CONTEXT (for tone + consistency only — do NOT rewrite this):
${context.slice(0, 6000)}

PASSAGE TO REVISE:
"""${selected}"""

INSTRUCTION: ${instruction}

Return the revised passage now.`;

  const { text } = await llmCall({ system, user, maxTokens: 1200 });
  // strip accidental wrapping quotes/fences the model sometimes adds
  return text.trim().replace(/^```[a-z]*\n?|\n?```$/g, '').trim().replace(/^["']|["']$/g, '').trim();
}
