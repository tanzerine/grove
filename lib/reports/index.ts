/**
 * Prospect reports — the keyword research grove runs on a site BEFORE its
 * owner has signed up, served at /r/<slug> as a private, unindexed page.
 *
 * Why this exists: outreach offered "a list of keywords a newer site can
 * actually win". A doc link is something anyone can make with any AI tool; a
 * page on grove's own domain, built from grove's research, that ends in
 * "connect your site and grove writes these" is the product introducing
 * itself. The strategy pipeline can't do this yet — it plans only for
 * verified domains (app/api/domains/[id]/strategy) — so v0 is concierge:
 * the research runs through scripts/prospect-research.mjs and the result is
 * curated into a typed module here. Every number on the page comes from the
 * module, and every derived number (totals, counts) is computed, so the page
 * can't disagree with its own data.
 *
 * Slugs carry a random suffix. The page is noindex and not in any sitemap,
 * but a guessable /r/krevaya would let anyone read another founder's report.
 */
import { krevaya } from './krevaya';

export type Keyword = {
  keyword: string;
  /** Monthly searches, Google US (DataForSEO Labs). */
  volume: number;
  /** Keyword difficulty, 0–100. */
  kd: number;
};

/** A similar-size site already ranking for the keyword — the evidence that
 *  a small domain can win it, which a difficulty score alone is not. */
export type Proof = { site: string; position: number; pageType: string };

export type ArticleRec = {
  title: string;
  target: Keyword;
  /** Other phrases the same article covers. Not summed into totals:
   *  spelling variants reach the same people. */
  also?: Keyword[];
  proof?: Proof;
  /** One sentence: why the reader of this search is a buyer. */
  why: string;
};

export type Retarget = {
  path: string;
  target: Keyword;
  change: string;
  proof?: Proof;
};

export type Skip = { keyword: string; volume: number; kd: number; why: string };

export type CurrentRank = { keyword: string; volume: number; position: number; path: string };

export type ProspectReport = {
  slug: string;
  domain: string;
  /** ISO date the research was pulled. */
  researchedOn: string;
  /** Who it's from, as the prospect knows them. */
  preparedBy: string;
  currentRanks: CurrentRank[];
  /** Competitors whose rankings were scanned for winnable keywords. */
  peers: string[];
  articles: ArticleRec[];
  retargets: Retarget[];
  skips: Skip[];
  trust: string[];
  source: string;
};

export const REPORTS: ProspectReport[] = [krevaya];

export function getReport(slug: string): ProspectReport | null {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}

/** Keywords that place in the top 50 — what "ranks" means to a reader. */
export function rankingTop50(r: ProspectReport): number {
  return r.currentRanks.filter((k) => k.position <= 50).length;
}

/** Monthly searches the recommended articles target, one figure per article
 *  (the target only — variants of one search are the same people). */
export function articleSearches(r: ProspectReport): number {
  return r.articles.reduce((s, a) => s + a.target.volume, 0);
}

/** Distinct keywords the report recommends acting on, first mention wins. */
export function winnableKeywords(r: ProspectReport): Keyword[] {
  const seen = new Map<string, Keyword>();
  const add = (k: Keyword) => { if (!seen.has(k.keyword)) seen.set(k.keyword, k); };
  for (const a of r.articles) { add(a.target); (a.also ?? []).forEach(add); }
  for (const t of r.retargets) add(t.target);
  return [...seen.values()];
}

export function winnableCount(r: ProspectReport): number {
  return winnableKeywords(r).length;
}

/** The hardest keyword the report recommends — stated on the page, so it is
 *  computed rather than typed. */
export function maxRecommendedKd(r: ProspectReport): number {
  return Math.max(0, ...winnableKeywords(r).map((k) => k.kd));
}

/**
 * Sign-up link for the report's call to action. The domain pre-fills
 * onboarding (AuthForm reads ?domain=), and the utm tags land in first-touch
 * attribution (lib/attribution.ts) so a signup from a report is countable.
 */
export function reportSignupHref(r: ProspectReport): string {
  const q = new URLSearchParams({
    domain: r.domain,
    utm_source: 'report',
    utm_medium: 'outreach',
    utm_campaign: r.slug,
  });
  return `/signup?${q.toString()}`;
}

/** "November 6, 2026" — fixed to UTC so the server's zone can't move the day. */
export function formatReportDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}
