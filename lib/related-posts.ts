/**
 * "Keep reading" — pick the most related sibling posts for a blog article.
 *
 * Pure title-token overlap, no LLM and no extra schema: it runs on every
 * public page render so it must be instant. Splits on whitespace/punctuation
 * (not \W) so CJK titles keep their words. Falls back to most-recent when
 * nothing overlaps, so the block never disappears on a young blog.
 */

export type RelatedCandidate = {
  slug: string;
  title: string | null;
  meta_description?: string | null;
  cover_image_url?: string | null;
  published_at?: string | null;
};

export const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your',
  'you', 'how', 'what', 'why', 'when', 'is', 'are', 'vs', 'at', 'by', 'from',
  'it', 'its', 'that', 'this', 'best', 'guide', 'complete', 'ultimate', 'top',
  'tips', 'ways', 'things', 'should', 'know', 'need', 'do', 'does', 'can',
]);

export function titleTokens(title: string | null | undefined): Set<string> {
  if (!title) return new Set();
  return new Set(
    title
      .toLowerCase()
      .split(/[\s,.;:!?()[\]{}"'`~/\\|—–\-·]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t)),
  );
}

export function pickRelated(
  current: { slug: string; title: string | null },
  candidates: RelatedCandidate[],
  n = 3,
): RelatedCandidate[] {
  const cur = titleTokens(current.title);
  const pool = candidates.filter((c) => c.slug && c.slug !== current.slug);

  const recency = (c: RelatedCandidate) => (c.published_at ? Date.parse(c.published_at) || 0 : 0);
  const scored = pool.map((c) => {
    let overlap = 0;
    for (const t of titleTokens(c.title)) if (cur.has(t)) overlap++;
    return { c, overlap };
  });

  scored.sort((a, b) => b.overlap - a.overlap || recency(b.c) - recency(a.c));

  const related = scored.filter((s) => s.overlap > 0).slice(0, n).map((s) => s.c);
  if (related.length >= n) return related;

  // pad with most-recent posts not already chosen
  const chosen = new Set(related.map((c) => c.slug));
  for (const s of scored) {
    if (related.length >= n) break;
    if (!chosen.has(s.c.slug)) { related.push(s.c); chosen.add(s.c.slug); }
  }
  return related;
}
