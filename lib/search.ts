/**
 * Tavily search — AI-optimized web search.
 * https://docs.tavily.com  (free 1000 queries/month)
 *
 * Returns { url, title, snippet } so the LLM can cite real sources by URL.
 * If TAVILY_API_KEY is unset, returns [] — the pipeline still works, just
 * without live citations (the validator will flag thin-citation drafts).
 */
export type SearchResult = { url: string; title: string; snippet: string };

/** A search result carrying the page's extracted main content (for SERP analysis). */
export type DeepResult = SearchResult & { content: string };

export async function webSearch(query: string, max = 5): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: max,
        search_depth: 'basic',
        include_answer: false,
      }),
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? r.url,
      snippet: r.content ?? '',
    }));
  } catch {
    return [];
  }
}

/**
 * Deep search — `advanced` depth + raw page content for the top organic
 * results. This is what powers real SERP analysis (what the ranking pages
 * actually cover). Costs more Tavily credit than `webSearch` (advanced = 2 vs
 * basic = 1), so callers use it sparingly — one call per article. Fail-soft: []
 * on any error or missing key, exactly like webSearch.
 */
export async function webSearchDeep(query: string, max = 5): Promise<DeepResult[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: max,
        search_depth: 'advanced',
        include_raw_content: true,
        include_answer: false,
      }),
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const j = await res.json();
    return (j.results ?? []).map((r: any) => ({
      url: r.url,
      title: r.title ?? r.url,
      snippet: r.content ?? '',
      content: r.raw_content ?? r.content ?? '',
    }));
  } catch {
    return [];
  }
}
