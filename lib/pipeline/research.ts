import { llmCall, extractJson } from '../llm';
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

CRITICAL OUTPUT RULES:
- Output ONE raw JSON object. Nothing else.
- No markdown. No backticks. No code fences.
- No preamble like "Here is the JSON".
- All string values must be plain text — never embed code blocks or backticks.`;

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

Return one JSON object with these exact keys (plain text values only, no markdown):
keyword, search_intent, common_structure, information_gain_hooks, citations, outline, winning_angle.

Shape:
keyword: string
search_intent: "informational" | "commercial" | "navigational"
common_structure: string[]
information_gain_hooks: array of { angle, why_it_matters, strength: "high" | "medium" }
citations: array of { claim, url, source_type: "primary" | "secondary" } — URL must come from the search results above
outline: array of { h2, subsections: string[], covers: "table_stakes" | "info_gain" }
winning_angle: string (one-sentence thesis)`;

  const { text } = await llmCall({ system: SYSTEM, user, maxTokens: 4000, json: true });
  return extractJson<Research>(text);
}
