/**
 * Layered research before the writer runs.
 *
 * One Tavily search isn't enough for genuine E-E-A-T content. We pull THREE
 * angles in parallel:
 *   - primary_sources  — direct topic results (the table-stakes evidence)
 *   - competitor_sources — what competitors / alternatives say about this topic
 *   - pain_sources     — common mistakes / problems / questions on this topic
 *
 * The writer prompt uses all three so the article can take a sharper, more
 * defensible angle and avoid sounding like a generic AI summary.
 */
import { webSearch, type SearchResult } from '../search';
import { gatherQuestions } from '../strategy/keywords';
import { analyzeSerp, type SerpCoverage } from './serp';
import type { SiteProfile } from './site-profile';

export type ResearchContext = {
  primary: SearchResult[];
  competitor: SearchResult[];
  pain: SearchResult[];
  /** Real searcher questions (free PAA proxy via autocomplete) the article
   *  should answer — drives the brief's FAQ + answer-first blocks (AEO/GEO). */
  questions: string[];
  /** What the live top-ranking pages actually cover — real SERP analysis used
   *  to shape coverage + find gaps. Empty when SERP analysis is off/unavailable. */
  serp: SerpCoverage;
};

export async function gatherContext(
  topic: string,
  profile: SiteProfile,
  targetKeyword?: string,
): Promise<ResearchContext> {
  const industry = profile.business.industry ?? '';
  const audience = profile.business.target_audience ?? '';

  // When the strategy assigned a real search keyword, search that exact phrase
  // too — it's what the article needs to rank for, so we want sources that
  // match the searcher's actual query, not just our paraphrased topic.
  const kw = targetKeyword?.trim();
  const [primaryTopic, primaryKw, competitor, pain, questions, serp] = await Promise.all([
    webSearch(topic, 5),
    kw && kw.toLowerCase() !== topic.toLowerCase() ? webSearch(kw, 3) : Promise.resolve([]),
    webSearch(`best tools alternatives ${topic}`, 3),
    webSearch(`${topic} mistakes problems pitfalls ${audience}`, 3),
    // Free PAA proxy — what people actually ask about this exact query.
    gatherQuestions(kw || topic, { limit: 8 }).catch(() => [] as string[]),
    // Real SERP analysis — what the live top-ranking pages cover (one advanced
    // Tavily call; fail-soft + env-gated inside analyzeSerp).
    analyzeSerp(kw || topic).catch(() => ({ subtopics: [], headings: [] } as SerpCoverage)),
  ]);
  const primary = [...primaryKw, ...primaryTopic];

  // dedupe by URL across buckets so we don't double-cite the same source
  const seen = new Set<string>();
  const dedupe = (list: SearchResult[]) => list.filter((s) => {
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });

  return {
    primary: dedupe(primary),
    competitor: dedupe(competitor),
    pain: dedupe(pain),
    questions,
    serp: { subtopics: serp.subtopics, headings: serp.headings },
  };
}

/** Flat list of every cited source in order — used by post-processor to
 *  rewrite numeric [N] refs into real markdown links. */
export function flatSources(ctx: ResearchContext): SearchResult[] {
  return [...ctx.primary, ...ctx.competitor, ...ctx.pain];
}
