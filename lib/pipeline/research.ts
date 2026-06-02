import { llmCall } from '../llm';
import { webSearch } from '../search';

export type Research = {
  keyword: string;
  search_intent: 'informational' | 'commercial' | 'navigational';
  common_structure: string[];
  information_gain_hooks: { angle: string; why_it_matters: string; strength: 'high' | 'medium' }[];
  citations: { claim: string; url: string; source_type: 'primary' | 'secondary' }[];
  outline: { h2: string; subsections: string[]; covers: 'table_stakes' | 'info_gain' }[];
  winning_angle: string;
};

const SYSTEM = `You are a content research specialist. You receive a keyword and a
batch of fresh web search results, then output a research brief as JSON.

Job:
1. Identify the common structure top-ranking pages cover (table stakes)
2. Identify 2-3 information gain gaps competitors miss
3. Use only the provided search results for citations — never invent URLs
4. Reject recycled stats and generic angles

Output ONLY a JSON object. No preamble.`;

export async function runResearch(keyword: string, customerContext = ''): Promise<Research> {
  // Live search via Tavily; falls back to empty list if no API key.
  const results = await webSearch(keyword, 8);
  const searchBlock = results.length
    ? results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join('\n\n')
    : '(no live search results — work from training data; omit invented URLs)';

  const customerLine = customerContext ? `\nCustomer context: ${customerContext}\n` : '';
  const user = `Target keyword: ${keyword}${customerLine}

WEB SEARCH RESULTS:
${searchBlock}

Output JSON in this exact shape:
{
  "keyword": "...",
  "search_intent": "informational|commercial|navigational",
  "common_structure": ["section 1", "section 2"],
  "information_gain_hooks": [{ "angle": "...", "why_it_matters": "...", "strength": "high|medium" }],
  "citations": [{ "claim": "...", "url": "from the search results above", "source_type": "primary|secondary" }],
  "outline": [{ "h2": "...", "subsections": ["..."], "covers": "table_stakes|info_gain" }],
  "winning_angle": "one-sentence thesis"
}`;

  const { text } = await llmCall({ system: SYSTEM, user, maxTokens: 4000, json: true });
  const raw = text.match(/\{[\s\S]*\}/)?.[0] ?? '';
  if (!raw) throw new Error(`research: no JSON in response. Got: ${text.slice(0, 300)}`);
  return JSON.parse(raw) as Research;
}
