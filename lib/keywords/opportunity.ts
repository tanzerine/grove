/**
 * Step 4 of the strategy loop: given keywords with real demand and difficulty
 * numbers, decide which ones are actually worth writing.
 *
 * ── Why this is a module and not a prompt line ─────────────────────────────
 * The planner used to receive a bare comma-separated list of Autocomplete
 * phrases and pick from it on semantic plausibility, because that list carried
 * no volume and no difficulty — the two terms of the only tradeoff that
 * matters. "Most efficient keyword" is arithmetic, and arithmetic belongs in
 * a tested function rather than in a model's judgement.
 *
 * ── The score has UNITS, on purpose ────────────────────────────────────────
 * `score` is estimated monthly impressions: volume × the probability this
 * domain can rank for it. That is a quantity someone can argue with. The
 * tempting alternative — multiplying in a fudge factor for intent, freshness
 * or brand fit — produces a bigger number that means nothing, and nobody can
 * then say whether a 40 is good. Intent is carried alongside and balanced by
 * the pillars' `intent_mix`, which is where that judgement already lives.
 */
import type { SearchIntent } from '../strategy/keywords';

export type ScoredKeyword = {
  keyword: string;
  /** Monthly searches. Null when the source could not say — Autocomplete never
   *  can, and that null is a measurement of the data gap, not a defect. */
  volume: number | null;
  /** 0-100, KD-style: how hard the top 10 is. Null = unknown, same as above. */
  difficulty: number | null;
  intent: SearchIntent | null;
  source: string;
  /** What Google itself has shown this domain for. See RevealedDemand. */
  revealed?: RevealedDemand | null;
};

/**
 * Demand the domain has already SEEN, from Search Console: Google showed one
 * of its pages for this query `impressions` times in a `days`-day window, at
 * `position` on average.
 *
 * This exists because the purchased number is wrong in a specific direction.
 * Ads volume is bucketed, rounded, single-country and blind to anything new;
 * measured on oveners.com it put "3d icon generator" at 20/mo while the
 * domain's own page-2 result was shown 627 times in 28 days — and 17 of the
 * site's top 20 queries were not in the database at all. A 100/mo floor
 * applied to that number deleted the site's entire winning cluster. An
 * impression is a search that happened, so it is a LOWER bound on demand,
 * and a lower bound the domain has already proven it can reach.
 */
export type RevealedDemand = {
  impressions: number;
  clicks: number;
  /** Impression-weighted average position, 1 = top. */
  position: number;
  /** The window the impressions were counted over. */
  days: number;
};

/** Impressions per 30 days — the same unit as `volume`, so the two compare. */
export function revealedMonthly(r: RevealedDemand | null | undefined): number | null {
  if (!r || !(r.days > 0) || !(r.impressions >= 0)) return null;
  return Math.round((r.impressions * 30) / r.days);
}

/**
 * The demand figure the rest of the pipeline should reason about: the larger
 * of what was bought and what was observed. Impressions can only undercount
 * (a page-2 result is shown to a fraction of searchers), so when they exceed
 * the purchased figure the purchased figure is the one that is wrong.
 */
export function effectiveVolume(k: Pick<ScoredKeyword, 'volume' | 'revealed'>): number | null {
  const seen = revealedMonthly(k.revealed);
  if (k.volume == null) return seen;
  if (seen == null) return k.volume;
  return Math.max(k.volume, seen);
}

/**
 * The hardest keyword a domain can realistically win.
 *
 * 30 is the number the field uses for a young site, and it is a DEFAULT, not a
 * constant: difficulty is a property of a keyword AND a domain, so the same
 * KD 35 that is hopeless for a three-week-old blog is routine for the same
 * blog two years on. Once gsc_metrics has enough history this should be learned
 * per domain — what KD band does this site actually convert into positions? —
 * and passed in. Until then every domain gets the cautious number.
 */
export const DEFAULT_KD_CEILING = 30;

/**
 * Probability this domain ranks well enough to earn the keyword's traffic.
 *
 * Deliberately a blunt piecewise curve rather than a fitted model: nothing in
 * grove has the data to fit one yet, and a precise-looking coefficient would
 * imply a confidence that does not exist. It encodes three defensible claims
 * and nothing more — comfortably below the ceiling is a near-certain win, the
 * odds fall off through the ceiling, and well past it is a long shot but never
 * literally zero (a floor of 0.02, because "impossible" is a stronger claim
 * than the data supports and a zero would erase an otherwise huge keyword).
 */
export function winProbability(difficulty: number | null, ceiling = DEFAULT_KD_CEILING): number {
  if (difficulty == null) return 0;           // unknown is not a bet we can size
  const c = Math.max(1, ceiling);
  const easy = c * 0.5;
  const hard = c * 1.5;
  if (difficulty <= easy) return 1;
  if (difficulty >= hard) return 0.02;
  const decayed = 1 - (difficulty - easy) / (hard - easy);
  return Math.max(0.02, Number(decayed.toFixed(4)));
}

/**
 * Win probability from the domain's OWN position, for a query no provider has
 * a difficulty for. The domain already ranks; the only question is how far
 * it has to climb. Coarser than winProbability on purpose — four bands, no
 * curve — because a position is one page's result on one query, not a
 * measurement of the SERP.
 */
export function positionWinProbability(position: number): number {
  if (!(position > 0)) return 0;
  if (position <= 10) return 1;
  if (position <= 20) return 0.7;
  if (position <= 30) return 0.4;
  return 0.2;
}

/**
 * The probability actually used: difficulty when it is known — it describes
 * the top 10, which is the prize — and the domain's own position only to
 * fill the gap. Zero when neither exists: unknown is not a bet we can size.
 */
export function rankProbability(kw: ScoredKeyword, ceiling = DEFAULT_KD_CEILING): number {
  if (kw.difficulty != null) return winProbability(kw.difficulty, ceiling);
  if (kw.revealed && kw.revealed.position > 0) return positionWinProbability(kw.revealed.position);
  return 0;
}

/** True when the keyword carries enough to be scored at all. */
export function isScorable(kw: ScoredKeyword): boolean {
  return effectiveVolume(kw) != null && (kw.difficulty != null || !!(kw.revealed && kw.revealed.position > 0));
}

/**
 * Estimated monthly impressions if we write this. An unscorable keyword —
 * no demand figure, or neither a difficulty nor an observed position — scores
 * 0: not because it is bad, but because an unscorable candidate must never
 * outrank a measured one. `selectKeywords` counts them separately so the gap
 * stays visible instead of looking like a pile of worthless keywords.
 */
export function opportunityScore(kw: ScoredKeyword, ceiling = DEFAULT_KD_CEILING): number {
  if (!isScorable(kw)) return 0;
  return Math.round((effectiveVolume(kw) ?? 0) * rankProbability(kw, ceiling));
}

export type SelectOptions = {
  limit?: number;
  /** Hard reject above this. Defaults to 1.5× the ceiling — past the point
   *  where winProbability has bottomed out, so keeping them only crowds the
   *  shortlist. */
  maxDifficulty?: number;
  /** Hard reject below this. 100/mo is the field's usual floor for "worth a
   *  page at all". */
  minVolume?: number;
  ceiling?: number;
};

export type Selection = {
  chosen: ScoredKeyword[];
  /** Why each rejected keyword lost, keyed by keyword — this is what makes the
   *  plan explainable to the owner and re-screenable later. */
  rejected: { keyword: string; reason: 'too_hard' | 'too_small' | 'unscorable' }[];
  /** How many candidates carried no volume/difficulty at all. A high number
   *  here means the demand SOURCE is the problem, not the selection. */
  unscorable: number;
  /**
   * Measured, winnable, and under the volume floor. Never a pillar — but the
   * cluster module's whole argument is that a page ranks for its VARIANTS, and
   * a phrase-exact expansion of a seed is mostly variants at 20-90/mo. Cutting
   * them here, before clustering, is what left grove's own plan with two
   * clusters on 2026-09-13: the floor removed the tail the clusters were
   * built to sum. build.ts hands these to buildClusters as members only; a
   * cluster whose total still misses the floor is dropped there.
   */
  longTail: ScoredKeyword[];
};

/**
 * Rank and cut. Returns the reasons as well as the winners, because "why not
 * this one" is a question both the owner and next month's planner will ask,
 * and because a rejection is a snapshot — a keyword too hard today is
 * re-screenable once the domain's ceiling rises.
 */
export function selectKeywords(cands: ScoredKeyword[], opts: SelectOptions = {}): Selection {
  const ceiling = opts.ceiling ?? DEFAULT_KD_CEILING;
  const maxDifficulty = opts.maxDifficulty ?? ceiling * 1.5;
  const minVolume = opts.minVolume ?? 100;
  const limit = opts.limit ?? 40;

  const rejected: Selection['rejected'] = [];
  const scorable: ScoredKeyword[] = [];
  const longTail: ScoredKeyword[] = [];
  let unscorable = 0;

  for (const c of cands) {
    if (!isScorable(c)) {
      unscorable++;
      rejected.push({ keyword: c.keyword, reason: 'unscorable' });
      continue;
    }
    if (c.difficulty != null && c.difficulty > maxDifficulty) { rejected.push({ keyword: c.keyword, reason: 'too_hard' }); continue; }
    // The floor is applied to what was OBSERVED as well as what was bought:
    // a phrase Ads calls 20/mo that showed this domain 600 times last month
    // is not small, whatever the database says.
    const vol = effectiveVolume(c) ?? 0;
    if (vol < minVolume) {
      rejected.push({ keyword: c.keyword, reason: 'too_small' });
      if (vol > 0) longTail.push(c);
      continue;
    }
    scorable.push(c);
  }

  const chosen = scorable
    .sort((a, b) => {
      const d = opportunityScore(b, ceiling) - opportunityScore(a, ceiling);
      // Ties break toward the EASIER keyword: two keywords with the same
      // expected impressions are not equally good bets, and the cheaper win
      // also compounds into authority sooner.
      return d !== 0 ? d : (a.difficulty ?? 100) - (b.difficulty ?? 100);
    })
    .slice(0, limit);

  return { chosen, rejected, unscorable, longTail };
}
