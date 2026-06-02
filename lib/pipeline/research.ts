import { llmCall } from '../llm';

export type Research = {
  keyword: string;
  search_intent: 'informational' | 'commercial' | 'navigational';
  common_structure: string[];
  information_gain_hooks: { angle: string; why_it_matters: string; strength: 'high' | 'medium' }[];
  citations: { claim: string; url: string; source_type: 'primary' | 'secondary' }[];
  outline: { h2: string; subsections: string[]; covers: 'table_stakes' | 'info_gain' }[];
  winning_angle: string;
};

const SYSTEM = `You are a content research specialist.

You do NOT have live web access. Work entirely from your training data and the
customer context provided. Don't hallucinate URLs — if you're not sure a source
exists, omit the citation. For citations, only include URLs you're confident
exist (well-known publications, official documentation, established research orgs).

Your job:
1. Identify the typical structure of top-ranking pages for the keyword (table stakes)
2. Identify 2-3 information gain gaps — angles competitors typically miss
3. Suggest 4-6 citation candidates with real, recognizable URLs
4. Reject recycled stats and generic angles. Be ruthlessly selective.

Output ONLY a JSON object inside a \`\`\`json code block, no preamble.`;

export async function runResearch(keyword: string, customerContext = ''): Promise<Research> {
  const customerLine = customerContext ? `\nCustomer context: ${customerContext}\n` : '';
  const user = `Target keyword: ${keyword}${customerLine}

Output JSON in this exact shape:
\`\`\`json
{
  "keyword": "...",
  "search_intent": "informational|commercial|navigational",
  "common_structure": ["section 1", "section 2"],
  "information_gain_hooks": [{ "angle": "...", "why_it_matters": "...", "strength": "high|medium" }],
  "citations": [{ "claim": "...", "url": "...", "source_type": "primary|secondary" }],
  "outline": [{ "h2": "...", "subsections": ["..."], "covers": "table_stakes|info_gain" }],
  "winning_angle": "one-sentence thesis"
}
\`\`\``;

  const { text } = await llmCall({ system: SYSTEM, user, maxTokens: 4000 });

  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : (text.match(/\{[\s\S]*\}/)?.[0] ?? '');
  if (!raw) throw new Error(`research: no JSON in response. Got: ${text.slice(0, 300)}`);
  return JSON.parse(raw) as Research;
}
