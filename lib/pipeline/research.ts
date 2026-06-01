import { geminiCall } from '../gemini';

export type Research = {
  keyword: string;
  search_intent: 'informational' | 'commercial' | 'navigational';
  common_structure: string[];
  information_gain_hooks: { angle: string; why_it_matters: string; strength: 'high' | 'medium' }[];
  citations: { claim: string; url: string; source_type: 'primary' | 'secondary' }[];
  outline: { h2: string; subsections: string[]; covers: 'table_stakes' | 'info_gain' }[];
  winning_angle: string;
};

const SYSTEM = `You are a content research specialist. Your job in one call:
1. Search the target keyword and analyze the top ranking pages
2. Identify common structure — table stakes
3. Identify 2-3 information gain gaps — angles competitors do not cover
4. Gather 4-6 fresh primary-source citations with real URLs and verified facts
5. Reject recycled stats and generic angles. Be ruthlessly selective.

Output ONLY a JSON object inside a \`\`\`json code block, no preamble.`;

export async function runResearch(keyword: string, customerContext = ''): Promise<Research> {
  const customerLine = customerContext ? `\nCustomer context: ${customerContext}\n` : '';
  const user = `Target keyword: ${keyword}${customerLine}

Use Google Search to research current top pages. Then output JSON in this exact shape:
{
  "keyword": "...",
  "search_intent": "informational|commercial|navigational",
  "common_structure": ["section 1", "section 2"],
  "information_gain_hooks": [{ "angle": "...", "why_it_matters": "...", "strength": "high|medium" }],
  "citations": [{ "claim": "...", "url": "...", "source_type": "primary|secondary" }],
  "outline": [{ "h2": "...", "subsections": ["..."], "covers": "table_stakes|info_gain" }],
  "winning_angle": "one-sentence thesis"
}
Return ONLY the JSON inside a json code block.`;

  const { text, sources } = await geminiCall({ system: SYSTEM, user, withSearch: true, maxTokens: 4000 });

  // Prefer the fenced JSON block; fall back to the first {...} match.
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!raw) throw new Error('research: no JSON in response');

  const parsed = JSON.parse(raw) as Research;

  // If the model returned fewer than 4 citations, supplement with grounded sources.
  if ((parsed.citations?.length ?? 0) < 4 && sources.length) {
    const extra = sources.slice(0, 6 - (parsed.citations?.length ?? 0)).map((s) => ({
      claim: s.title, url: s.uri, source_type: 'secondary' as const,
    }));
    parsed.citations = [...(parsed.citations ?? []), ...extra];
  }
  return parsed;
}
