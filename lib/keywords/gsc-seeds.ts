/**
 * Search Console as a keyword SOURCE, not just a report.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The planner expanded seeds through a keyword database and never looked at
 * the one list of searches that is known to be real: the queries Google has
 * already shown this domain for. Measured on oveners.com (2026-09-16, 90
 * days) that list held the site's best commercial traffic and the pipeline
 * could not see any of it —
 *
 *   - two competitor brand names, 1,000+ impressions at position ~6 and zero
 *     clicks, because the ranking page was a listicle that merely mentioned
 *     them. "{brand} alternative" is the least crowded, most commercial
 *     keyword available to a challenger, and nothing generated it;
 *   - "illustrator 3d logo" and kin, ~250 impressions: people making the
 *     product's output by hand — buyers who have not found generators yet;
 *   - every phrase above sized at 10-40/mo by the database, so the volume
 *     floor deleted it and the plan chose a 4,400/mo Android icon-pack query
 *     instead.
 *
 * ── What this module does with the list ────────────────────────────────────
 * Three things, and all of them are PURE so the heuristics are testable:
 *
 *   seeds        queries the domain ranks top-20 for → expanded through Labs
 *                like any other seed. The siblings of a query we already
 *                rank for are the cheapest new targets there are.
 *   competitors  queries that look like another product's name → the caller
 *                turns them into alternative/vs seeds (buyerIntentSeeds).
 *   revealed     queries we appear for at position > 20 — no page of ours is
 *                close, so a dedicated article is the right move — carried
 *                into the pool with their impressions attached
 *                (ScoredKeyword.revealed) so the floor and the score see
 *                what Google saw rather than what Ads guessed.
 *
 * Queries at position ≤ 20 are deliberately NOT candidates. A page of ours
 * already owns them; a second article aimed at the same query splits the
 * signal between two of our URLs (the near-winner rule in build.ts). They
 * are seeds, not targets.
 */
import type { LangCode } from '../language';
import { classifyIntent } from '../strategy/keywords';
import { isBrandTerm } from '../strategy/seeds';
import { clusterTokens } from './cluster';
import type { ScoredKeyword, RevealedDemand } from './opportunity';

/** One row of the Search Console query dimension. */
export type GscQueryRow = {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
};

export type GscResearchPlan = {
  /** Top-20 queries worth expanding, best first. */
  seeds: string[];
  /** Queries that read as another product's name. Raw, as searched. */
  competitors: string[];
  /** Position > 20 queries, as candidates carrying revealed demand. */
  revealed: ScoredKeyword[];
  /** How many rows were discarded as not-a-search (see isJunkQuery). */
  junk: number;
};

export type GscPlanOptions = {
  lang: LangCode;
  /** The business's own name — its brand queries are not demand. */
  brand?: string | null;
  /**
   * Phrases the domain is already researching from (ICP vocabulary, product
   * names, existing seeds). A query made entirely of these words is generic;
   * one carrying a word none of them contain is how a competitor is spotted.
   */
  vocab?: string[];
  /** Window the snapshot covers. Search Console's default snapshot is 28. */
  days?: number;
  maxSeeds?: number;
  maxCompetitors?: number;
  /** Below this many impressions in the window a query is noise. */
  minImpressions?: number;
};

/**
 * Rows that are not searches. Search Console increasingly carries the raw
 * prompts LLM assistants send to Google ("context: location: israel … question:
 * …"), operator queries pasted from a monitoring tool ("… -site:reddit.com"),
 * and IDE slash-commands. None of them is a phrase anyone would target.
 */
export function isJunkQuery(query: string): boolean {
  const q = (query ?? '').trim();
  if (!q) return true;
  const lower = q.toLowerCase();
  if (/\bcontext\s*:/.test(lower) || /\bquestion\s*:/.test(lower)) return true;   // assistant prompt
  if (/(^|\s)-?site:/.test(lower)) return true;                                    // search operator
  if (/(^|\s)[+%]?\/[a-z][\w-]*/.test(lower)) return true;                          // slash command
  if (/^[+%"'`]/.test(q)) return true;                                              // operator / quote prefix
  if (q.split(/\s+/).length > 12) return true;                                      // a sentence, not a query
  return false;
}

/** Latin word tokens, lowercased, stopwords out — the vocabulary unit. */
function contentWords(phrase: string): string[] {
  return [...clusterTokens(phrase)].filter((t) => /^[a-z0-9][a-z0-9-]*$/.test(t));
}

/**
 * Does this query read as another product's name?
 *
 * The signature, on real data: top-10 position, real impressions, and
 * (almost) no clicks — the searcher wanted a specific thing and we were not
 * it — AND a distinctive word the domain's own vocabulary does not contain
 * ("iconikai", "applaunchflow"). Each half alone misfires: a how-to query can
 * sit at position 6 with zero clicks, and "3d icon ai generator" is all
 * vocabulary. Short, because brand queries are.
 *
 * Latin-script only for now: the distinctive-word test has no CJK analogue
 * here, and a Korean brand query falls through as an ordinary seed rather
 * than being mislabelled.
 */
export function looksLikeCompetitorQuery(row: GscQueryRow, vocab: Set<string>): boolean {
  const words = (row.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  if (!(row.position > 0 && row.position <= 10)) return false;
  if (row.impressions < 30) return false;
  if (row.clicks / row.impressions >= 0.01) return false;
  return contentWords(row.query).some((w) => w.length >= 6 && !/^\d+$/.test(w) && !vocab.has(w));
}

function vocabSet(phrases: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of phrases) for (const w of contentWords(p)) out.add(w);
  return out;
}

/**
 * Turn the query snapshot into research inputs. Pure.
 */
export function gscResearchPlan(rows: GscQueryRow[], opts: GscPlanOptions): GscResearchPlan {
  const days = opts.days ?? 28;
  const maxSeeds = opts.maxSeeds ?? 6;
  const maxCompetitors = opts.maxCompetitors ?? 4;
  const minImpressions = opts.minImpressions ?? 10;
  const vocab = vocabSet(opts.vocab ?? []);

  let junk = 0;
  const clean: GscQueryRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const query = (r?.query ?? '').trim();
    if (!query || !(r.impressions >= 0)) continue;
    if (isJunkQuery(query)) { junk++; continue; }
    if (isBrandTerm(query, opts.brand)) continue;      // our own name is not demand
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ query, impressions: r.impressions, clicks: r.clicks ?? 0, position: r.position });
  }
  clean.sort((a, b) => b.impressions - a.impressions);

  const competitors: string[] = [];
  const competitorSet = new Set<string>();
  for (const r of clean) {
    if (competitors.length >= maxCompetitors) break;
    if (looksLikeCompetitorQuery(r, vocab)) {
      competitors.push(r.query.toLowerCase());
      competitorSet.add(r.query.toLowerCase());
    }
  }

  // Seeds: top-20, real impressions, and no seed whose words CONTAIN another
  // seed's. Labs exact-matches the phrase in order, so the expansion of
  // "3d icon generator" already includes every "ai 3d icon generator" row —
  // the three spellings would spend three calls on one result set. When a
  // shorter phrase arrives after a longer one it takes the longer one's place.
  const seeds: string[] = [];
  const seedToks: Set<string>[] = [];
  const subset = (a: Set<string>, b: Set<string>) => a.size <= b.size && [...a].every((t) => b.has(t));
  for (const r of clean) {
    if (competitorSet.has(r.query.toLowerCase())) continue;
    if (!(r.position > 0 && r.position <= 20)) continue;
    if (r.impressions < Math.max(minImpressions, 20)) continue;
    if (r.query.split(/\s+/).length > 8) continue;      // a question is a query; a paragraph is not
    const toks = clusterTokens(r.query);
    if (!toks.size) continue;
    const q = r.query.toLowerCase();
    const within = seedToks.findIndex((t) => subset(t, toks));   // an existing seed covers this
    if (within >= 0) continue;
    const covers = seedToks.findIndex((t) => subset(toks, t));   // this covers an existing seed
    if (covers >= 0) { seeds[covers] = q; seedToks[covers] = toks; continue; }
    if (seeds.length >= maxSeeds) continue;
    seeds.push(q);
    seedToks.push(toks);
  }

  // Revealed candidates: we appear, nothing of ours is close.
  const revealed: ScoredKeyword[] = [];
  for (const r of clean) {
    if (competitorSet.has(r.query.toLowerCase())) continue;
    if (!(r.position > 20)) continue;
    if (r.impressions < minImpressions) continue;
    const rev: RevealedDemand = {
      impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10, days,
    };
    revealed.push({
      keyword: r.query.toLowerCase(),
      volume: null,
      difficulty: null,
      intent: classifyIntent(r.query, opts.lang),
      source: 'gsc',
      revealed: rev,
    });
  }

  return { seeds, competitors, revealed, junk };
}

/**
 * Put revealed candidates into the research pool.
 *
 * A revealed phrase takes the provider's numbers when the provider has any —
 * from the sizing call (`sized`) or from an expansion that happened to return
 * the same phrase — and keeps its impressions either way. It replaces the
 * pool's copy rather than sitting beside it: same phrase, strictly more
 * information. Pure; order of the incoming pool is preserved.
 */
export function mergeRevealed(
  pool: ScoredKeyword[],
  revealed: ScoredKeyword[],
  sized: ScoredKeyword[] = [],
): ScoredKeyword[] {
  if (!revealed.length) return pool;
  const norm = (k: string) => k.trim().toLowerCase();
  const bySized = new Map(sized.map((k) => [norm(k.keyword), k]));
  const byRevealed = new Map(revealed.map((k) => [norm(k.keyword), k]));

  const enrich = (rev: ScoredKeyword, provider: ScoredKeyword | undefined): ScoredKeyword => ({
    keyword: rev.keyword,
    volume: provider?.volume ?? rev.volume,
    difficulty: provider?.difficulty ?? rev.difficulty,
    intent: provider?.intent ?? rev.intent,
    source: 'gsc',
    revealed: rev.revealed ?? null,
  });

  const out: ScoredKeyword[] = [];
  const placed = new Set<string>();
  for (const k of pool) {
    const key = norm(k.keyword);
    const rev = byRevealed.get(key);
    if (rev && !placed.has(key)) {
      out.push(enrich(rev, bySized.get(key) ?? k));
      placed.add(key);
    } else if (!rev) {
      out.push(k);
    }
  }
  for (const rev of revealed) {
    const key = norm(rev.keyword);
    if (placed.has(key)) continue;
    placed.add(key);
    out.push(enrich(rev, bySized.get(key)));
  }
  return out;
}
