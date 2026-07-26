/**
 * Article search for the dashboard search bar.
 *
 * The database does the coarse work (an `ilike` union per token); this decides
 * the order the customer actually sees. Ranking is pure so it can run in two
 * places: server-side in /api/posts/search, and client-side against the posts
 * the overview page already loaded — that's what makes the first keystroke feel
 * instant while the request is still in flight.
 *
 * Splits on whitespace/punctuation (not \W) so Korean/Japanese titles keep
 * their words, same as `related-posts`. Matching is substring-based on purpose:
 * search is typed one letter at a time, so "cof" must already find "coffee".
 */

export type SearchablePost = {
  id: string;
  title: string | null;
  topic: string | null;
  slug: string | null;
  meta_description?: string | null;
  status?: string | null;
  published_at?: string | null;
  scheduled_at?: string | null;
  created_at?: string | null;
};

const SPLIT = /[\s,.;:!?()[\]{}"'`~/\\|—–\-·]+/;

/** Fields searched, most to least meaningful. */
const FIELDS: Array<{ key: keyof SearchablePost; weight: number }> = [
  { key: 'title', weight: 10 },
  { key: 'topic', weight: 6 },
  { key: 'slug', weight: 3 },
  { key: 'meta_description', weight: 2 },
];

/** The columns both the DB filter and the ranker look at. */
export const SEARCH_FIELDS = ['title', 'topic', 'slug', 'meta_description'] as const;

/** Lowercased, punctuation collapsed to single spaces — the form both the
 *  query and the searched fields are compared in. */
export function normalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().split(SPLIT).filter(Boolean).join(' ');
}

export function queryTokens(q: string): string[] {
  return normalize(q).split(' ').filter(Boolean);
}

/**
 * The `or=(…)` filter that pulls candidate rows out of Postgres: any token, in
 * any searched column. Deliberately looser than the ranker, which then applies
 * AND semantics — one round trip instead of one per token.
 *
 * PostgREST parses that filter string itself, so a value carrying a comma,
 * paren, quote or backslash would break out of it. Tokenizing already drops
 * most punctuation; this strips what survives, plus the `%`/`_` ilike wildcards
 * so a typed "%" searches for a literal percent instead of matching everything.
 * Returns '' when nothing usable is left — the caller must not query then.
 */
export function orFilter(tokens: string[], limit = 6): string {
  return tokens
    .map((t) => t.replace(/[,()"'\\%_*]/g, ''))
    .filter(Boolean)
    .slice(0, limit)
    .flatMap((t) => SEARCH_FIELDS.map((f) => `${f}.ilike.%${t}%`))
    .join(',');
}

/** Score one field. `hit` per token is tracked separately from the score so
 *  the caller can require every token to land somewhere (AND semantics). */
function scoreField(text: string, tokens: string[], phrase: string): { score: number; hit: boolean[] } {
  const hit = tokens.map(() => false);
  const hay = normalize(text);
  if (!hay) return { score: 0, hit };

  let score = 0;
  // The whole query as one phrase beats the same words scattered around.
  if (tokens.length > 1 && hay.includes(phrase)) score += 6;

  tokens.forEach((t, i) => {
    const at = hay.indexOf(t);
    if (at === -1) return;
    hit[i] = true;
    score += 2;
    const startsWord = at === 0 || hay[at - 1] === ' ';
    const endsWord = at + t.length === hay.length || hay[at + t.length] === ' ';
    if (startsWord) score += 1;      // prefix of a word, not a fragment inside one
    if (startsWord && endsWord) score += 1; // whole word
    if (at === 0) score += 1;        // the field itself starts here
  });

  return { score, hit };
}

/** Newest-first tiebreaker: when it went (or will go) live, else when it was created. */
function recencyOf(p: SearchablePost): number {
  const iso = p.published_at ?? p.scheduled_at ?? p.created_at ?? null;
  return iso ? Date.parse(iso) || 0 : 0;
}

/**
 * Rank `posts` against `query`, best first. A post only matches when EVERY
 * query token appears somewhere in it, so adding a word narrows the list the
 * way people expect. Returns [] for a blank/one-character query.
 */
export function searchPosts<T extends SearchablePost>(posts: T[], query: string, limit?: number): T[] {
  const tokens = queryTokens(query);
  if (!tokens.length || normalize(query).length < 2) return [];
  const phrase = tokens.join(' ');

  const scored: { post: T; score: number }[] = [];
  for (const post of posts) {
    const matched = tokens.map(() => false);
    let score = 0;
    for (const f of FIELDS) {
      const raw = post[f.key];
      if (typeof raw !== 'string') continue;
      const r = scoreField(raw, tokens, phrase);
      if (!r.score) continue;
      score += r.score * f.weight;
      r.hit.forEach((h, i) => { if (h) matched[i] = true; });
    }
    if (!score || matched.some((m) => !m)) continue;
    scored.push({ post, score });
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    recencyOf(b.post) - recencyOf(a.post) ||
    (a.post.title ?? '').localeCompare(b.post.title ?? ''));

  const ranked = scored.map((s) => s.post);
  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
}

/**
 * Split `text` into alternating plain/matched segments so the UI can bold what
 * the customer typed. Overlapping matches are merged; order is preserved.
 */
export function highlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const tokens = queryTokens(query);
  if (!text || !tokens.length) return text ? [{ text, hit: false }] : [];

  const hay = text.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const t of tokens) {
    let from = 0;
    while (true) {
      const i = hay.indexOf(t, from);
      if (i === -1) break;
      spans.push([i, i + t.length]);
      from = i + t.length;
    }
  }
  if (!spans.length) return [{ text, hit: false }];

  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [spans[0]];
  for (const [s, e] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const out: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), hit: false });
    out.push({ text: text.slice(s, e), hit: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}
