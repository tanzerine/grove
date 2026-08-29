/**
 * Genre + byline for public blog articles.
 *
 * Every article gets a reader-facing genre. The pipeline already decides a
 * `format` per brief (research.brief.format) — we map it to a display genre,
 * and fall back to title heuristics for older posts that predate the field.
 * Pure functions so the mapping is unit-testable.
 */
import { language, normalizeLang, type LangCode } from './language';

export type Genre = { id: string; label: string };

/** pipeline format → genre id. The id is stable across languages; only the
 *  label a reader sees is translated (GENRE_LABELS). */
const FORMAT_GENRES: Record<string, string> = {
  guide: 'guide',
  experiment: 'case-study',
  opinion: 'opinion',
  launch: 'news',
  curation: 'roundup',
  roadmap: 'roadmap',
  'behind-the-scenes': 'inside',
  list: 'listicle',
  tutorial: 'tutorial',
  'deep-dive': 'deep-dive',
};

const GENRE_LABELS: Record<LangCode, Record<string, string>> = {
  en: {
    guide: 'Guide', 'case-study': 'Case study', opinion: 'Opinion', news: 'News',
    roundup: 'Roundup', roadmap: 'Roadmap', inside: 'Inside look', listicle: 'Listicle',
    tutorial: 'Tutorial', 'deep-dive': 'Deep dive', comparison: 'Comparison', article: 'Article',
  },
  ko: {
    guide: '가이드', 'case-study': '사례 연구', opinion: '오피니언', news: '소식',
    roundup: '모음', roadmap: '로드맵', inside: '비하인드', listicle: '리스트',
    tutorial: '튜토리얼', 'deep-dive': '심층 분석', comparison: '비교', article: '아티클',
  },
  es: {
    guide: 'Guía', 'case-study': 'Caso práctico', opinion: 'Opinión', news: 'Novedades',
    roundup: 'Recopilación', roadmap: 'Hoja de ruta', inside: 'Entre bastidores', listicle: 'Lista',
    tutorial: 'Tutorial', 'deep-dive': 'Análisis a fondo', comparison: 'Comparativa', article: 'Artículo',
  },
  zh: {
    guide: '指南', 'case-study': '案例研究', opinion: '观点', news: '动态',
    roundup: '精选', roadmap: '路线图', inside: '幕后', listicle: '清单',
    tutorial: '教程', 'deep-dive': '深度解析', comparison: '对比', article: '文章',
  },
};

/** The reader-facing label for a genre id, in the blog's language. */
export function genreLabel(id: string, lang: LangCode = 'en'): string {
  const table = GENRE_LABELS[normalizeLang(lang)];
  return table[id] ?? table.article;
}

export function genreFor(
  format?: string | null,
  title?: string | null,
  lang: LangCode = 'en',
): Genre {
  const g = (id: string): Genre => ({ id, label: genreLabel(id, lang) });
  if (format && FORMAT_GENRES[format]) return g(FORMAT_GENRES[format]);
  const t = (title ?? '').toLowerCase();
  if (/\bvs\.?\s|versus|\bcompared\b|비교|对比/.test(t)) return g('comparison');
  if (/deep dive|딥\s?다이브|深度/.test(t)) return g('deep-dive');
  if (/^how\s|how to|how we|방법|하는 법|가이드|cómo|如何|怎么/.test(t)) return g('guide');
  if (/^\d+\s|top \d+|best \d+|\d+가지|\d+个|\d+ (?:formas|maneras|claves)/.test(t)) return g('listicle');
  if (/^why\s|^왜\s|^por qué|为什么/.test(t)) return g('opinion');
  return g('article');
}

/**
 * Byline for credibility. Uses the founder's name when the site profile has
 * one; otherwise the language's org byline ("{Business} Team" / "{Business} 팀")
 * — never a bare "AI".
 */
export function authorFor(profile: any, hostname: string, lang: LangCode = 'en'): string {
  const business = profile?.business ?? null;
  const founder = business?.founder ?? business?.owner ?? null;
  if (typeof founder === 'string' && founder.trim()) return founder.trim();
  const name: string = business?.name || hostname.replace(/^www\./, '');
  return language(lang).orgByline(name);
}

/**
 * Is the byline the business itself rather than a person? Decides
 * schema.org Organization vs Person.
 *
 * Call sites used to ask `author.endsWith('Team')`, which is false for every
 * byline this file produces outside English ("Acme 팀", "Equipo de Acme").
 * Ask the profile, not the string.
 */
export function authorIsOrg(profile: any): boolean {
  const business = profile?.business ?? null;
  const founder = business?.founder ?? business?.owner ?? null;
  return !(typeof founder === 'string' && founder.trim());
}
