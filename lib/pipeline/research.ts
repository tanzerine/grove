import { anthropic, MODEL } from '../anthropic';

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
1. Search the target keyword and analyze the top 10 ranking pages
2. Identify common structure — table stakes
3. Identify 2-3 information gain gaps — angles NONE of the top 10 cover
4. Gather 4-6 fresh primary-source citations with real URLs and verified facts
5. Reject recycled stats and generic angles. Be ruthlessly selective.
You output ONLY a JSON object, no preamble.`;

export async function runResearch(keyword: string, customerContext = ''): Promise<Research> {
  const customerLine = customerContext ? `\nCustomer context: ${customerContext}\n` : '';
  const user = `Target keyword: ${keyword}${customerLine}

Run web searches as needed. Output JSON in this exact shape:
{
  "keyword": "...",
  "search_intent": "informational|commercial|navigational",
  "common_structure": ["section 1", "section 2"],
  "information_gain_hooks": [{ "angle": "...", "why_it_matters": "...", "strength": "high|medium" }],
  "citations": [{ "claim": "...", "url": "...", "source_type": "primary|secondary" }],
  "outline": [{ "h2": "...", "subsections": ["..."], "covers": "table_stakes|info_gain" }],
  "winning_angle": "one-sentence thesis the post will defend"
}
Return ONLY the JSON.`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 } as any],
    messages: [{ role: 'user', content: user }],
  });

  const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('research: no JSON in response');
  return JSON.parse(m[0]);
}
