/**
 * Comparison mode — the one format where grove names competitors.
 *
 * Everywhere else the brand's blog never names a rival (writer "NEVER SEND THE
 * READER ELSEWHERE", validator REFERRAL_AWAY, manager no_referral_away). That
 * rule came from oveners.com shipping "tools like 3D AI Studio" in the middle
 * of a how-to, and it is right for a how-to. It is wrong for the searches a
 * young SaaS can actually win: "buffer alternatives", "hootsuite alternative",
 * "best tools to schedule social media posts". The reader typed a rival's name
 * or asked for a list; an article that refuses to name anyone fails the search
 * outright. Measured on krevaya.com (2026-11-06): the top three buyer-intent
 * keywords were all of this shape, and the planner would have handed them to a
 * writer forbidden to answer them.
 *
 * So the ban is lifted ONLY when the target keyword is itself a comparison
 * query, and it is replaced by stricter rules rather than none:
 *   - every fact about a rival (price, plan limit, feature) is linked to a
 *     source, so nothing about another company is invented;
 *   - the brand discloses that it makes one of the products on the list;
 *   - every rival gets one honest reason to pick it, and the brand gets its
 *     own catch — a list where only the author wins reads as an ad, and both
 *     readers and answer engines discount it.
 *
 * The decision is deterministic (the keyword), never the refiner's choice: a
 * model that could opt into comparison mode could opt every article out of
 * the competitor ban.
 */

/** Queries where the reader asked for rivals by name or for a ranked list. */
const COMPARISON_PATTERNS: RegExp[] = [
  /\balternatives?\b/i,
  /\b(?:vs\.?|versus)\b/i,
  /\bcompetitors?\b/i,
  /\bcompared?\b|\bcomparison\b/i,
  // "best social media scheduling tools", "best tools to schedule posts"
  /^best\b.*\b(?:tools?|software|apps?|platforms?|services?|schedulers?|generators?)\b/i,
];

export function isComparisonKeyword(keyword: string | null | undefined): boolean {
  const k = (keyword ?? '').trim();
  if (!k) return false;
  return COMPARISON_PATTERNS.some((re) => re.test(k));
}

/** Inline citations a comparison may keep. One source per rival's price or
 *  plan, plus the usual few — the 4-link cap would strip the very links that
 *  make a claim about another company checkable. */
export const COMPARISON_CITATION_CAP = 12;

/** Above this the validator calls a comparison over-cited (default mode: 5). */
export const COMPARISON_OVER_CITED = 14;

/** The writer's format line, beside experiment/guide/list. */
export const COMPARISON_FORMAT_LINE =
  '   - comparison       → the reader asked for rivals by name or a ranked list. Name the real products, compare them on the same few criteria, and say who each one is for';

/** Replaces the writer's "NEVER SEND THE READER ELSEWHERE" block. */
export function comparisonWriterRules(businessName: string): string {
  return `COMPARISON RULES (this brief is a comparison — the reader searched for rivals or a list)
- You MAY name competing products. The article fails its search if it doesn't.
- Disclose once, in the first 120 words, that ${businessName} makes one of the
  products on the list, e.g. "We make ${businessName}, so weigh our place on this list accordingly."
- Every fact about a rival (price, plan limit, free tier, feature, channel count)
  must carry an inline [text](url) link to that rival's own page or a research
  source, and say when it was checked ("as of <Month YYYY>"). No source, no claim:
  describe the product without the number instead.
- Never call a rival bad, slow, buggy or overpriced without a linked fact behind it.
- Give EVERY rival one specific, honest reason to choose it ("Pick X if…").
- Give ${businessName} its own entry with the same scrutiny, including one real catch.
- Include ONE comparison table: product, who it's for, starting price, the catch.
- Compare on the same 3–5 criteria throughout, so the list reads as a comparison,
  not a stack of product blurbs.
- Agencies, studios and freelancers are still out of scope: never tell the reader
  to hire one.`;
}

/** Label for the research block the writer may cite rivals from. */
export const COMPARISON_SOURCES_LABEL =
  '### Competitor / alternative sources (COMPARISON MODE — you may cite these for facts about the rivals they describe)';

/** The manager's replacement for no_referral_away on a comparison brief. */
export const COMPARISON_RUBRIC_RULE =
  'This brief is a COMPARISON (the reader searched for alternatives, a "vs", or a ranked list), so naming competing products is required, not a violation. Flag instead: a fact about a rival (price, limit, feature) with no linked source; a missing disclosure that the brand makes one of the listed products; a rival given no honest reason to choose it; the brand exempted from scrutiny; or any advice to hire an agency or studio.';

/** "We make Krevaya", "we build krevaya", "Krevaya is our product". */
export function hasDisclosure(post: string, businessName: string): boolean {
  const name = businessName.trim();
  if (!name) return false;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`\\bwe (?:make|build|built|run|created|founded)\\s+${n}\\b`, 'i'),
    new RegExp(`\\b${n} is (?:our|the) (?:product|tool|app) we (?:make|build)\\b`, 'i'),
    new RegExp(`\\b${n} is our (?:own )?(?:product|tool|app)\\b`, 'i'),
  ].some((re) => re.test(post));
}

/** A markdown table: a header row followed by a |---| separator row. */
export function hasComparisonTable(post: string): boolean {
  return /^\s*\|.+\|\s*\n\s*\|\s*:?-{3,}/m.test(post);
}
