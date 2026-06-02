/**
 * Tavily search — AI-optimized web search.
 * https://docs.tavily.com  (free 1000 queries/month)
 *
 * Returns { url, title, snippet } so the LLM can cite real sources by URL.
 * If TAVILY_API_KEY is unset, returns [] — the pipeline still works, just
 * without live citations (the validator will flag thin-citation drafts).
 */
export type SearchResult = { url: string; title: string; snippet: string };

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
