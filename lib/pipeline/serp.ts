/**
 * Real SERP analysis — read what's actually ranking for the target query and
 * distill the subtopics the winning pages consistently cover. This is the
 * KoalaWriter/SEOwind move: instead of guessing structure, reverse-engineer it
 * from the live results, so the article covers what Google already rewards and
 * the writer can deliberately out-do (or counter) it.
 *
 * The fetch (analyzeSerp) is one `advanced` Tavily call per article and is
 * fail-soft + env-disablable. The distillation (extractSerpCoverage) is pure,
 * so the ranking logic is unit-tested without the network.
 */
import { webSearchDeep } from '../search';
import { STOP } from '../related-posts';

export type SerpCoverage = {
  subtopics: string[];   // consensus terms/phrases the ranking pages cover
  headings: string[];    // section headings detected in the ranking pages
};

export type SerpInsights = SerpCoverage & { sources: { url: string; title: string }[] };

// Web/SEO filler that says nothing about the topic — never a useful "subtopic".
const GENERIC = new Set([
  'guide', 'best', 'top', 'how', 'what', 'why', 'when', 'review', 'reviews', 'vs',
  'blog', 'article', 'learn', 'tips', 'ways', 'things', 'need', 'know', 'about',
  'using', 'use', 'used', 'make', 'making', 'get', 'getting', 'your', 'you', 'our',
  'their', 'they', 'more', 'most', 'one', 'two', 'first', 'step', 'steps', 'read',
  'example', 'examples', 'website', 'com', 'www', 'https', 'http', 'home', 'click',
  'free', 'online', 'good', 'great', 'like', 'also', 'will', 'can', 'this', 'that',
]);

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9가-힣]+/i).map((t) => t.trim()).filter(Boolean);

function usable(tok: string, kwTokens: Set<string>): boolean {
  if (tok.length < 3 || tok.length > 24) return false;
  if (/^\d+$/.test(tok)) return false;
  if (STOP.has(tok) || GENERIC.has(tok)) return false;
  if (kwTokens.has(tok)) return false;           // the keyword itself isn't a "subtopic"
  return true;
}

/**
 * Distill consensus subtopics + section headings from the ranking pages.
 * Subtopics are unigrams/bigrams ranked by how many distinct pages use them
 * (document frequency) — a term several competitors all cover is a real gap to
 * close — then by total frequency. Near-duplicates (a unigram inside a chosen
 * bigram) are collapsed.
 */
export function extractSerpCoverage(
  pages: { title?: string | null; content?: string | null }[],
  keyword: string,
  limit = 12,
): SerpCoverage {
  const kwTokens = new Set(tokenize(keyword));
  const docFreq = new Map<string, number>();
  const totFreq = new Map<string, number>();
  const headings: string[] = [];

  for (const page of pages) {
    const text = `${page.content ?? ''}`;
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*#{1,4}\s+(.{3,80}?)\s*#*\s*$/);
      if (m) headings.push(m[1].replace(/\s+/g, ' ').trim());
    }

    const toks = tokenize(text);
    const seen = new Set<string>();
    const bump = (phrase: string) => {
      totFreq.set(phrase, (totFreq.get(phrase) ?? 0) + 1);
      if (!seen.has(phrase)) { seen.add(phrase); docFreq.set(phrase, (docFreq.get(phrase) ?? 0) + 1); }
    };
    for (let i = 0; i < toks.length; i++) {
      if (usable(toks[i], kwTokens)) bump(toks[i]);
      if (i + 1 < toks.length && usable(toks[i], kwTokens) && usable(toks[i + 1], kwTokens)) {
        bump(`${toks[i]} ${toks[i + 1]}`);
      }
    }
  }

  const candidates = [...new Set([...docFreq.keys()])]
    .filter((p) => (docFreq.get(p) ?? 0) >= 2 || (totFreq.get(p) ?? 0) >= 4)
    .sort((a, b) =>
      (docFreq.get(b)! - docFreq.get(a)!) ||
      // prefer phrases over their component unigrams (more informative, and it
      // keeps the bigram from being collapsed away by a higher-frequency word)
      ((b.includes(' ') ? 1 : 0) - (a.includes(' ') ? 1 : 0)) ||
      (totFreq.get(b)! - totFreq.get(a)!) ||
      (b.length - a.length),
    );

  const subtopics: string[] = [];
  for (const c of candidates) {
    if (subtopics.length >= limit) break;
    // collapse near-duplicates: skip if it contains, or is contained by, a pick
    if (subtopics.some((x) => x.includes(c) || c.includes(x))) continue;
    subtopics.push(c);
  }

  const uniqHeadings = [...new Set(headings)].filter(Boolean).slice(0, 15);
  return { subtopics, headings: uniqHeadings };
}

/**
 * Coverage gap — of the consensus subtopics the ranking pages cover, which ones
 * does this draft NOT address? This is the Clearscope/Surfer "content grade"
 * idea: a subtopic several competitors all cover but the article skips is a real
 * ranking liability. Lenient on purpose (a subtopic counts as covered if its
 * phrase appears, or — for multi-word — all its words appear) so we only flag
 * genuine omissions. Returns up to `max` missing subtopics, in input order.
 */
export function coverageGap(subtopics: string[], body: string, max = 6): string[] {
  if (!subtopics?.length || !body) return [];
  const hay = ` ${body.toLowerCase().replace(/[^a-z0-9가-힣]+/gi, ' ')} `;
  const has = (w: string) => hay.includes(` ${w} `);

  const missing: string[] = [];
  for (const raw of subtopics) {
    const phrase = raw.toLowerCase().trim();
    if (!phrase) continue;
    const words = phrase.split(/\s+/);
    const covered = words.length > 1
      ? hay.includes(` ${phrase} `) || words.every(has)
      : has(phrase);
    if (!covered) missing.push(raw);
    if (missing.length >= max) break;
  }
  return missing;
}

/**
 * Fetch the live top results for `query` and distill their coverage. One
 * advanced Tavily call. Returns empty insights on any failure, when there's no
 * Tavily key, or when GROVE_SERP_ANALYSIS=off — callers treat it as best-effort.
 */
export async function analyzeSerp(query: string, max = 5): Promise<SerpInsights> {
  const empty: SerpInsights = { subtopics: [], headings: [], sources: [] };
  if (process.env.GROVE_SERP_ANALYSIS === 'off') return empty;
  const q = query.trim();
  if (!q) return empty;

  try {
    const results = await webSearchDeep(q, max);
    if (!results.length) return empty;
    const cov = extractSerpCoverage(results.map((r) => ({ title: r.title, content: r.content })), q);
    return { ...cov, sources: results.map((r) => ({ url: r.url, title: r.title })) };
  } catch {
    return empty;
  }
}
