/**
 * The demand floor: grove does not commission an article whose whole reachable
 * demand is under 50 searches a month — with a short, named list of exceptions.
 *
 * ── Why 50, and why it has to be enforced on the PLAN ──────────────────────
 * Measured 2026-09-23 on the 51 aged posts grove has published against a
 * target keyword: 31 targets were absent from DataForSEO entirely, and of the
 * 20 that carried a figure, 15 sat under 50/mo and none exceeded 500. The
 * whole portfolio earned 570 impressions. Ranking cannot rescue a page whose
 * query nobody types — 131 of 220 post×query pairs were ALREADY top-10 and
 * still earned nothing.
 *
 * The research pipeline already had a floor (100/mo on a cluster's total), so
 * how did those targets get through? The planner LLM is told to pick cluster
 * pillars and nothing checked that it did: 58% of slots came back with a
 * keyword it invented, which by construction had no volume. So the floor is
 * applied in three places, and the last one is the one that matters:
 *   1. selectKeywords — a phrase under it can't LEAD a cluster (it can still
 *      join one as a member; see Selection.longTail)
 *   2. build.ts       — a cluster whose TOTAL is under it is dropped
 *   3. gateSlots      — every slot the planner returns is checked against the
 *      measured pool, and one that fails is replaced from an unused cluster
 *
 * ── The exceptions ─────────────────────────────────────────────────────────
 * - Search Console impressions count as demand. Already true everywhere via
 *   `effectiveVolume`: Ads undercounts the tail 10-30x, and a phrase that
 *   showed this domain 600 times last month is not small whatever Labs says.
 * - A BUYER-STAGE query needs only 10/mo. "iconikai alternative", "x vs y",
 *   "x pricing": the person typing it is choosing a product this week. Ten of
 *   them are worth more than five hundred people reading a definition — and
 *   these are exactly the phrases Ads can't see (oveners' competitor queries
 *   sat at position 6 with 600+ impressions and no Labs volume at all).
 *   Intent alone does not qualify: Labs tags broad head terms "commercial",
 *   and a floor that any commercial phrase can walk under is not a floor.
 *   The phrase has to SAY it is a decision.
 */
import type { ScoredKeyword } from './opportunity';

export const MIN_MONTHLY_DEMAND = 50;
export const BUYER_MIN_DEMAND = 10;

/**
 * Phrases that announce a purchase decision, per language. A word-boundary
 * match for Latin scripts; CJK has no word spaces, so a substring match.
 * `best … for` needs both halves — "best" alone is how every listicle head
 * term starts.
 */
const BUYER_PATTERNS: RegExp[] = [
  /\b(alternatives?|vs\.?|versus|compared?|comparison|pricing|price|cost|costs|reviews?|coupon|discount|promo code|free trial|buy)\b/i,
  /\bbest\b.+\bfor\b/i,
  /(대안|대체|비교|가격|요금|비용|후기|리뷰|추천|할인|쿠폰|구매|업체)/,
  /\b(alternativas?|comparación|comparativa|precio|precios|opiniones|reseñas?|mejor(es)? .+ para)\b/i,
  /(替代|对比|比较|价格|多少钱|评测|测评|推荐|优惠|购买)/,
];

export function isBuyerQuery(keyword: string): boolean {
  const k = (keyword ?? '').trim();
  return !!k && BUYER_PATTERNS.some((re) => re.test(k));
}

/** Why a phrase or a cluster clears the floor, or null when it does not. */
export type FloorPass = 'demand' | 'buyer_intent';

/**
 * The one floor rule. `total` is the demand the ARTICLE can reach — a
 * cluster's summed effective volume, or a lone phrase's own — and `lead` is
 * the phrase the article targets, which decides the buyer exception.
 */
export function demandFloor(total: number | null, lead: string, min = MIN_MONTHLY_DEMAND): FloorPass | null {
  if (total == null) return null;
  if (total >= min) return 'demand';
  if (total >= BUYER_MIN_DEMAND && isBuyerQuery(lead)) return 'buyer_intent';
  return null;
}

// ── the plan gate ─────────────────────────────────────────────────────────

/** What the gate knows about a keyword: the article's reachable demand. */
export type DemandFact = {
  keyword: string;
  /** Cluster total when the keyword is a pillar, else its own effective volume. */
  total: number | null;
  /** The cluster's other phrases, when the keyword leads one. */
  members: string[];
};

export type GateSlot = { target_keyword?: string; topic: string; secondary_keywords?: string[]; notes?: string };

export type SlotDecision =
  | { verdict: 'keep'; pass: FloorPass }
  | { verdict: 'replace'; reason: 'too_small' | 'unmeasured' };

/** Pure. Exported so the verdict for one slot is assertable on its own. */
export function judgeSlot(slot: GateSlot, fact: DemandFact | undefined, min = MIN_MONTHLY_DEMAND): SlotDecision {
  const kw = (slot.target_keyword ?? '').trim();
  if (!kw || !fact || fact.total == null) {
    // An unmeasured buyer query is the one gap this allows: those are the
    // phrases the database is known not to carry.
    if (kw && isBuyerQuery(kw)) return { verdict: 'keep', pass: 'buyer_intent' };
    return { verdict: 'replace', reason: 'unmeasured' };
  }
  const pass = demandFloor(fact.total, kw, min);
  return pass ? { verdict: 'keep', pass } : { verdict: 'replace', reason: 'too_small' };
}

export type GateResult<T> = {
  slots: T[];
  /** One line per slot the gate touched — for the build log. */
  changes: string[];
};

/**
 * Hold the planner to the pool it was given. Pure.
 *
 * Each slot whose target fails the floor is REWRITTEN onto the best cluster
 * no other slot uses — same pillar, goal, intent and date, new topic and
 * keywords — so the owner still gets the month they paid for. With no spare
 * cluster the slot is dropped: a month with fewer articles beats a month of
 * articles nobody can find, and the prompt already tells the planner to
 * plan fewer slots than it has relevant clusters.
 *
 * Never gates to zero. If every slot would go, the originals stand and the
 * caller logs it: an empty plan throws in buildStrategy, and the hourly
 * cron would then rebuild — and pay for — the same failing month forever.
 *
 * `facts` is keyed by lower-cased keyword; `spare` is clusters best-first.
 */
export function gateSlots<T extends GateSlot>(
  slots: T[],
  facts: Map<string, DemandFact>,
  spare: DemandFact[],
  min = MIN_MONTHLY_DEMAND,
): GateResult<T> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const used = new Set(slots.map((s) => norm(s.target_keyword ?? '')).filter(Boolean));
  const queue = spare.filter((c) => demandFloor(c.total, c.keyword, min) && !used.has(norm(c.keyword)));

  const out: T[] = [];
  const changes: string[] = [];
  for (const slot of slots) {
    const kw = slot.target_keyword ?? '';
    const d = judgeSlot(slot, facts.get(norm(kw)), min);
    if (d.verdict === 'keep') { out.push(slot); continue; }
    const next = queue.shift();
    const why = `"${kw || slot.topic}" (${d.reason}${facts.get(norm(kw))?.total != null ? `, ${facts.get(norm(kw))!.total}/mo` : ''})`;
    if (!next) { changes.push(`dropped ${why} — no unused cluster left`); continue; }
    used.add(norm(next.keyword));
    changes.push(`replaced ${why} with "${next.keyword}" (${next.total}/mo)`);
    // The planner's notes were about the topic being replaced; keeping them
    // would brief the writer on an article it is no longer writing.
    out.push({ ...slot, topic: next.keyword, target_keyword: next.keyword, secondary_keywords: next.members, notes: undefined });
  }

  if (!out.length && slots.length) {
    return { slots, changes: [...changes, `kept all ${slots.length} original slots — gating would have left the month empty`] };
  }
  return { slots: out, changes };
}

/**
 * The facts table for gateSlots, from the measured pool and the clusters it
 * became. A pillar's fact is its cluster total; any other measured phrase is
 * its own effective volume. Pure.
 *
 * `volumeOf` is opportunity.ts's `effectiveVolume`, passed in because that
 * module imports this one for the floor.
 */
export function demandFacts(
  pool: ScoredKeyword[],
  clusters: { pillar: ScoredKeyword; members: ScoredKeyword[]; totalVolume: number }[],
  volumeOf: (k: ScoredKeyword) => number | null,
): Map<string, DemandFact> {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const facts = new Map<string, DemandFact>();
  for (const k of pool) {
    facts.set(norm(k.keyword), {
      keyword: k.keyword, total: volumeOf(k), members: [],
    });
  }
  for (const c of clusters) {
    facts.set(norm(c.pillar.keyword), {
      keyword: c.pillar.keyword,
      total: c.totalVolume,
      members: c.members.map((m) => m.keyword),
    });
  }
  return facts;
}
