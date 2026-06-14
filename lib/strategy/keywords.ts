/**
 * Keyword demand research — free, no API key.
 *
 * Grove used to invent topics purely from the business profile, so the very
 * first month had zero grounding in what people actually search for. This
 * pulls real query phrases from Google Autocomplete (the same suggestions the
 * search box shows) for a handful of seed terms, expanded with intent
 * modifiers. Autocomplete is ordered by popularity, so a phrase's *rank* is a
 * usable ordinal demand proxy even without volume numbers.
 *
 * Fail-soft by design: any network hiccup yields [] and the strategist
 * proceeds on the profile alone — exactly how it behaved before.
 */

export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';
export type KeywordIdea = { keyword: string; intent: SearchIntent; score: number };

// Each seed fans out into a few variants so we capture different intents, not
// just the head term. Kept small on purpose — this runs inside a cron tick.
function variantsFor(seed: string): string[] {
  const s = seed.toLowerCase().trim();
  return [s, `how to ${s}`, `best ${s}`, `${s} vs`, `${s} for`, `${s} examples`];
}

/** Classify a query's search intent from its wording. Order matters: the most
 *  commercial signal wins. */
export function classifyIntent(kw: string): SearchIntent {
  const k = ` ${kw.toLowerCase()} `;
  if (/\b(buy|price|pricing|cost|cheap|deal|discount|coupon|order|trial|subscribe|quote)\b/.test(k))
    return 'transactional';
  if (/\b(best|top|vs|versus|alternative|alternatives|review|reviews|compare|comparison|cheapest|software|tool|tools|services?|companies|vendors?)\b/.test(k))
    return 'commercial';
  if (/\b(login|log in|sign in|sign up|download|app|dashboard)\b/.test(k) || /\.[a-z]{2,}\b/.test(k))
    return 'navigational';
  return 'informational';
}

function usable(kw: string): boolean {
  if (!kw) return false;
  if (kw.length < 3 || kw.length > 70) return false;
  if (!/[a-z]/i.test(kw)) return false;          // must contain letters
  if (/[<>{}|\\^~`]/.test(kw)) return false;       // junk / injection-ish
  return true;
}

/**
 * Rank raw autocomplete lists into scored keyword ideas. Pure — no network —
 * so it can be unit-tested directly.
 *
 * Scoring: a suggestion at position `i` in a list of length `n` earns `n - i`
 * (earlier = more popular). Appearing under multiple variants accumulates,
 * which surfaces the phrases with the broadest demand.
 */
export function rankSuggestions(lists: string[][], limit = 36): KeywordIdea[] {
  const scores = new Map<string, { score: number; display: string }>();
  for (const list of lists) {
    const n = list.length;
    list.forEach((raw, i) => {
      const display = raw.trim();
      if (!usable(display)) return;
      const key = display.toLowerCase();
      const add = n - i;
      const cur = scores.get(key);
      if (cur) cur.score += add;
      else scores.set(key, { score: add, display });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ display, score }) => ({ keyword: display, intent: classifyIntent(display), score }));
}

async function fetchAutocomplete(query: string, timeoutMs: number): Promise<string[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    // client=firefox returns ["query", ["suggestion 1", "suggestion 2", ...]]
    const data = JSON.parse(await res.text());
    return Array.isArray(data?.[1]) ? (data[1] as string[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Gather ranked, intent-classified keyword demand for a set of seed terms.
 * Returns [] on any failure so callers can treat it as best-effort signal.
 */
export async function gatherKeywordDemand(
  seeds: string[],
  opts: { maxSeeds?: number; limit?: number; timeoutMs?: number } = {},
): Promise<KeywordIdea[]> {
  const { maxSeeds = 4, limit = 36, timeoutMs = 4000 } = opts;

  // dedupe + cap seeds so the request fan-out stays bounded and polite
  const cleanSeeds = [...new Set(seeds.map((s) => s.toLowerCase().trim()).filter(Boolean))].slice(0, maxSeeds);
  if (!cleanSeeds.length) return [];

  const queries = cleanSeeds.flatMap(variantsFor);
  const lists = await Promise.all(queries.map((q) => fetchAutocomplete(q, timeoutMs)));
  return rankSuggestions(lists, limit);
}

/** Render demand into a compact, prompt-friendly block grouped by intent. */
export function formatDemandForPrompt(ideas: KeywordIdea[]): string {
  if (!ideas.length) return '(none captured — plan from the business profile)';
  const byIntent: Record<SearchIntent, string[]> = {
    informational: [], commercial: [], transactional: [], navigational: [],
  };
  for (const i of ideas) byIntent[i.intent].push(i.keyword);
  const lines: string[] = [];
  const label: Record<SearchIntent, string> = {
    informational: 'INFORMATIONAL (→ editorial/contextual)',
    commercial: 'COMMERCIAL (→ contextual/conversion)',
    transactional: 'TRANSACTIONAL (→ conversion)',
    navigational: 'NAVIGATIONAL (usually skip)',
  };
  (['informational', 'commercial', 'transactional'] as SearchIntent[]).forEach((k) => {
    if (byIntent[k].length) lines.push(`${label[k]}: ${byIntent[k].slice(0, 12).join(', ')}`);
  });
  return lines.join('\n');
}
