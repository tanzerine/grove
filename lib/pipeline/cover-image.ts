/**
 * Cover image fetcher (Unsplash).
 *
 * - Builds a search query from the article's chosen title via the LLM
 *   (so the query is semantic, not just keyword soup from the topic)
 * - Hits Unsplash random-photo endpoint with that query
 * - Returns URL + photographer credit
 *
 * Requires UNSPLASH_ACCESS_KEY (free Demo tier: 50 req/hour, no card).
 * https://unsplash.com/developers
 *
 * Returns null if unconfigured or the API fails — caller persists null and
 * the article renders without a cover (graceful degrade).
 */
import { llmCall } from '../llm';

export type Cover = {
  url: string;
  credit: { name: string; profile_url: string; source: 'unsplash' };
};

async function pickQuery(title: string, industry: string): Promise<string> {
  // ask the model for 2-3 evocative search terms — much better than blindly
  // jamming the title at Unsplash which returns generic stock photos
  try {
    const { text } = await llmCall({
      fast: true,
      maxTokens: 60,
      system: 'Output ONLY 2-4 lowercase search terms separated by spaces. No punctuation, no quotes, no preamble. Evocative, photographable terms (objects, materials, scenes).',
      user: `Article title: ${title}\nBusiness industry: ${industry}\n\nPick 2-4 search terms for a relevant cover photo.`,
    });
    return text.trim().replace(/[^a-z0-9 ]/gi, '').slice(0, 60) || title.toLowerCase().slice(0, 60);
  } catch {
    return title.toLowerCase().slice(0, 60);
  }
}

export async function fetchCoverImage(title: string, industry = ''): Promise<Cover | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return null;

  const query = await pickQuery(title, industry);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`,
      {
        signal: ctrl.signal,
        headers: { Authorization: `Client-ID ${key}` },
      },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.urls?.regular || !j?.user?.name) return null;

    return {
      url: j.urls.regular,                                  // ~1080px wide
      credit: {
        name: j.user.name,
        profile_url: j.user.links?.html ?? `https://unsplash.com/@${j.user.username}`,
        source: 'unsplash',
      },
    };
  } catch {
    return null;
  }
}
