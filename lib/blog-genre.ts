/**
 * Genre + byline for public blog articles.
 *
 * Every article gets a reader-facing genre. The pipeline already decides a
 * `format` per brief (research.brief.format) — we map it to a display genre,
 * and fall back to title heuristics for older posts that predate the field.
 * Pure functions so the mapping is unit-testable.
 */

export type Genre = { id: string; label: string };

const FORMAT_GENRES: Record<string, Genre> = {
  guide: { id: 'guide', label: 'Guide' },
  experiment: { id: 'case-study', label: 'Case study' },
  opinion: { id: 'opinion', label: 'Opinion' },
  launch: { id: 'news', label: 'News' },
  curation: { id: 'roundup', label: 'Roundup' },
  roadmap: { id: 'roadmap', label: 'Roadmap' },
  'behind-the-scenes': { id: 'inside', label: 'Inside look' },
  list: { id: 'listicle', label: 'Listicle' },
};

export function genreFor(format?: string | null, title?: string | null): Genre {
  if (format && FORMAT_GENRES[format]) return FORMAT_GENRES[format];
  const t = (title ?? '').toLowerCase();
  if (/\bvs\.?\s|versus|\bcompared\b|비교/.test(t)) return { id: 'comparison', label: 'Comparison' };
  if (/^how\s|how to|how we|방법|하는 법|가이드/.test(t)) return { id: 'guide', label: 'Guide' };
  if (/^\d+\s|top \d+|best \d+|\d+가지/.test(t)) return { id: 'listicle', label: 'Listicle' };
  if (/^why\s|^왜\s/.test(t)) return { id: 'opinion', label: 'Opinion' };
  return { id: 'article', label: 'Article' };
}

/**
 * Byline for credibility. Uses the founder's name when the site profile has
 * one; otherwise "{Business} Team" — never a bare "AI".
 */
export function authorFor(profile: any, hostname: string): string {
  const business = profile?.business ?? null;
  const founder = business?.founder ?? business?.owner ?? null;
  if (typeof founder === 'string' && founder.trim()) return founder.trim();
  const name: string = business?.name || hostname.replace(/^www\./, '');
  return `${name} Team`;
}
