/**
 * Step 2 of the strategy loop: who the customer actually is, before deciding
 * what to write for them.
 *
 * ── The gap this fills ─────────────────────────────────────────────────────
 * The planner went straight from the SITE PROFILE to keyword research, and the
 * site profile describes the BUSINESS: products_services, industry,
 * value_props. Those are the seller's words. People do not search in the
 * seller's words — they search in their own, about a problem, usually before
 * they know a product category exists. Seeding research from marketing copy is
 * how grove's own domain produced zero suggestions for every seed
 * ("Autonomous AI blog writing", "Zero upkeep and no dashboards to babysit")
 * and the planner fell back to writing about the product. See seeds.ts for the
 * measurements.
 *
 * So this step sits between them and answers a different question: given what
 * this business sells, WHO has the problem it solves, what do they call that
 * problem, and what makes them start looking? The output feeds `icpSeeds`,
 * which is what keyword research now expands from.
 *
 * ── Why the vocabulary field is the important one ──────────────────────────
 * The gap between "AI-powered content orchestration platform" and "how do I
 * write blog posts faster" is the entire difference between a plan that ranks
 * and a plan that does not. `vocabulary` is asked for explicitly, in the
 * customer's register rather than the brand's, because a model left to its own
 * devices will happily echo the marketing copy it was just shown.
 */
import { llmCall, extractJson } from '../llm';
import type { SiteProfile } from '../pipeline/site-profile';
import { seedCandidates, isBrandTerm } from './seeds';
import { language, languageCommand, competitorVariants, type LangCode } from '../language';

export type CustomerSegment = {
  /** "solo founder running a SaaS side project", not "SMB decision-maker". */
  name: string;
  situation: string;
};

export type CustomerProfile = {
  segments: CustomerSegment[];
  /** What they are trying to get done. */
  jobs: string[];
  /** What hurts now — the thing they would type at 11pm. */
  pains: string[];
  /** The event that makes someone start searching this week rather than never. */
  triggers: string[];
  /** THEIR words for the problem. Usually not the brand's words. */
  vocabulary: string[];
  /** What stops them committing — the objections content has to answer. */
  objections: string[];
  /**
   * The three below are the BUYER-INTENT half of the profile, added after the
   * first field measurement (oveners.com, 2026-09-16): the site's best
   * commercial impressions were competitor names and "make it by hand"
   * queries, and nothing in vocabulary/pains/jobs produces either. Optional in
   * the type because profiles stored before they existed lack them.
   */
  /** Named products this customer would compare against — "iconikai",
   *  "icons8 3d", not categories. */
  competitors?: string[];
  /** How they get the result TODAY without a product like this, as a search
   *  phrase: "3d icon in illustrator", "hire a designer on fiverr". */
  workarounds?: string[];
  /** Where the output goes, as a search phrase: "3d icons for saas landing
   *  page", "3d app icon ios". */
  use_cases?: string[];
};

const EMPTY: CustomerProfile = {
  segments: [], jobs: [], pains: [], triggers: [], vocabulary: [], objections: [],
  competitors: [], workarounds: [], use_cases: [],
};

const strs = (v: unknown, cap: number): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, cap)
    : [];

/**
 * Clamp whatever the model returned into the shape the rest of the pipeline
 * can rely on. Pure, so the parsing is tested without an LLM — and total,
 * because a half-parsed ICP must degrade to an empty one rather than to
 * undefined fields that blow up three steps later in seed derivation.
 */
export function normalizeIcp(raw: unknown): CustomerProfile {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const r = raw as Record<string, unknown>;
  const segments = Array.isArray(r.segments)
    ? r.segments
        .map((s: any) => ({
          name: typeof s?.name === 'string' ? s.name.trim() : '',
          situation: typeof s?.situation === 'string' ? s.situation.trim() : '',
        }))
        .filter((s) => s.name)
        .slice(0, 4)
    : [];
  return {
    segments,
    jobs: strs(r.jobs, 8),
    pains: strs(r.pains, 10),
    triggers: strs(r.triggers, 6),
    vocabulary: strs(r.vocabulary, 20),
    objections: strs(r.objections, 6),
    competitors: strs(r.competitors, 6),
    workarounds: strs(r.workarounds, 6),
    use_cases: strs(r.use_cases, 6),
  };
}

/** True when there is enough here to research from. */
export function icpIsUsable(icp: CustomerProfile | null | undefined): boolean {
  if (!icp) return false;
  return icp.vocabulary.length + icp.pains.length + icp.jobs.length >= 3;
}

/**
 * Step 3: the seed phrases keyword research expands from.
 *
 * Ordering is the whole design. `vocabulary` first because it is already
 * search-shaped and already in the customer's register; then `pains`, because
 * a problem statement is what someone types before they know what to buy;
 * then `jobs`. Callers cap with `limit`, so this order decides what survives.
 *
 * Every phrase goes through `seedCandidates` — the same narrowing the old
 * profile-based path used — so sentences become the noun phrases inside them,
 * and the brand's own name is dropped (a business name is not demand; it
 * classifies as informational and would otherwise reach the planner as
 * something to build a pillar on).
 */
export function icpSeeds(
  icp: CustomerProfile | null | undefined,
  opts: { limit?: number; brand?: string | null } = {},
): string[] {
  if (!icp) return [];
  const limit = opts.limit ?? 8;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...icp.vocabulary, ...icp.pains, ...icp.jobs]) {
    for (const cand of seedCandidates((raw ?? '').trim())) {
      const key = cand.toLowerCase();
      if (seen.has(key)) continue;
      if (isBrandTerm(cand, opts.brand)) continue;
      seen.add(key);
      out.push(cand);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Step 3, the buyer half: seeds for people who are already deciding.
 *
 * `icpSeeds` produces the informational pool — the problem in the customer's
 * words. This produces the phrases typed by someone further along: they are
 * looking at a competitor ("{name} alternative", "{name} vs"), they are
 * doing it by hand today (workarounds), or they know where the output goes
 * (use cases). Each is small in any database and each converts; together
 * they are where a young domain can actually win.
 *
 * `knownCompetitors` come first — names Search Console has ALREADY shown the
 * domain for are ground truth, the model's list is a guess — and the two are
 * merged by name so a brand in both spends one pair of seeds.
 *
 * Workarounds and use cases are passed through as written, NOT through
 * `seedCandidates`: that narrower splits on "for"/"with"/"in", and "3d icons
 * for saas landing page" is one buyer's query, not two topics. Labs
 * exact-matches the phrase in order, so a longer seed simply returns fewer,
 * closer results — the four-word ceiling was Autocomplete's.
 */
export function buyerIntentSeeds(
  icp: CustomerProfile | null | undefined,
  opts: { lang: LangCode; brand?: string | null; knownCompetitors?: string[]; limit?: number } = { lang: 'en' },
): string[] {
  const limit = opts.limit ?? 10;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): boolean => {
    const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!s || s.length < 3 || seen.has(s)) return false;
    if (s.split(' ').length > 6) return false;
    if (isBrandTerm(s, opts.brand)) return false;
    seen.add(s);
    out.push(s);
    return out.length >= limit;
  };

  const names: string[] = [];
  const nameSeen = new Set<string>();
  for (const n of [...(opts.knownCompetitors ?? []), ...(icp?.competitors ?? [])]) {
    const k = (n ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || nameSeen.has(k) || isBrandTerm(k, opts.brand)) continue;
    nameSeen.add(k);
    names.push(k);
  }
  for (const n of names.slice(0, 4)) {
    for (const v of competitorVariants(n, opts.lang)) if (push(v)) return out;
  }
  for (const w of icp?.workarounds ?? []) if (push(w)) return out;
  for (const u of icp?.use_cases ?? []) if (push(u)) return out;
  return out;
}

/**
 * Infer the customer profile from the site profile.
 *
 * The WORKHORSE model, not the fast one. The first production build after
 * this step shipped (trygroveai.com, 2026-09-13 10:46Z) came back with no
 * profile at all, and the plan it produced was seeded from the site's
 * industry label — "saas and b2b", "b2b saas company", "b2b saas meme" — the
 * exact failure this module exists to prevent. The call had gone to Llama
 * 3.2 3B with a 30s ceiling, asked for six arrays of customer-register
 * prose, and whatever it returned was unusable; the catch below swallowed it
 * without a line of log. Re-registering marketing copy into a customer's
 * words is judgement, not extraction, and a 3B model is the wrong tool for
 * it. One call per plan per month; the cost is noise.
 *
 * Fail-soft — an empty profile makes the caller fall back to the
 * profile-derived seeds rather than skipping the month — but LOUD: the
 * fallback is the degraded path, and a warning is the only way anyone finds
 * out it was taken.
 *
 * The language command goes FIRST in the user prompt, never in the system
 * prompt. That is not a style preference: grove's first ko-configured article
 * came back entirely in English because the directive sat at the tail of the
 * system prompt and all three models ignored it. Same lesson as
 * runSocialAdapter and the writer.
 */
export async function buildCustomerProfile(
  profile: Pick<SiteProfile, 'business'>,
  lang: LangCode = 'en',
  opts: { timeoutMs?: number } = {},
): Promise<CustomerProfile> {
  const biz = profile?.business;
  if (!biz) return EMPTY;
  const lg = language(lang);

  const system = `You infer the CUSTOMER from a description of a business.

You are given how a company describes itself — which is marketing copy, written
by the seller. Your job is to describe the person on the other side: what their
situation is, what they are trying to do, and CRUCIALLY what words they would
use, which are almost never the company's words.

Rules:
- Never reuse the company's product name or slogans as customer vocabulary.
- "vocabulary" and "pains" must be phrased the way someone types into a search
  box before they know a solution exists: plain, specific, often a complaint.
- Prefer the concrete over the demographic: "runs a two-person agency and does
  the invoicing at midnight" beats "SMB decision-maker".
- If the business serves several distinct groups, give at most 4 segments.
- "competitors" are NAMED products this customer would compare against — real
  product names only, never categories, never the company itself. Leave the
  list empty rather than invent one.
- "workarounds" and "use_cases" are SEARCH PHRASES (2-6 words), the way the
  query would be typed: "3d icon in illustrator", "3d icons for saas landing
  page" — not sentences.`;

  const user = `${languageCommand(lg)}

BUSINESS
name: ${biz.name ?? ''}
industry: ${biz.industry ?? ''}
description: ${biz.description ?? ''}
products/services: ${(biz.products_services ?? []).join(', ')}
stated audience: ${biz.target_audience ?? ''}
value props: ${(biz.value_props ?? []).join(', ')}
geography: ${biz.geography ?? ''}

Return JSON only:
{
  "segments":   [{ "name": "who they are, concretely", "situation": "the context they are in" }],
  "jobs":       ["what they are trying to get done"],
  "pains":      ["what hurts today, in their words"],
  "triggers":   ["the event that makes them start looking"],
  "vocabulary": ["short phrases THEY use for the problem — search-shaped, 2-5 words"],
  "objections": ["what stops them committing"],
  "competitors": ["named products they would compare against"],
  "workarounds": ["how they get the result today without this, as a search phrase"],
  "use_cases":   ["where the output goes, as a search phrase"]
}`;

  try {
    const { text } = await llmCall({ system, user, maxTokens: 1500, timeoutMs: opts.timeoutMs ?? 60_000 });
    const icp = normalizeIcp(extractJson<unknown>(text));
    if (!icpIsUsable(icp)) {
      console.warn(`[icp] profile for ${biz.name ?? '?'} came back too thin to research from (` +
        `${icp.vocabulary.length} vocabulary, ${icp.pains.length} pains, ${icp.jobs.length} jobs)`);
    }
    return icp;
  } catch (err) {
    console.warn(`[icp] customer profile inference failed for ${biz.name ?? '?'}: ${String((err as any)?.message ?? err)}`);
    return EMPTY;
  }
}

/**
 * Render the customer profile for the planner's prompt.
 *
 * Segments and pains are what make a slot's ANGLE land; vocabulary is already
 * spent by the time this is read (it produced the seeds), but it stays in
 * because the planner writes topics and titles, and those should sound like
 * the reader rather than the seller.
 */
export function formatIcpForPrompt(icp: CustomerProfile | null | undefined): string {
  if (!icp || !icpIsUsable(icp)) return '(not inferred — plan from the business profile)';
  const lines: string[] = [];
  for (const s of icp.segments) lines.push(`- ${s.name}${s.situation ? ` — ${s.situation}` : ''}`);
  if (icp.pains.length) lines.push(`pains: ${icp.pains.slice(0, 6).join(' · ')}`);
  if (icp.triggers.length) lines.push(`starts looking when: ${icp.triggers.slice(0, 4).join(' · ')}`);
  if (icp.objections.length) lines.push(`hesitates because: ${icp.objections.slice(0, 4).join(' · ')}`);
  if (icp.vocabulary.length) lines.push(`their words: ${icp.vocabulary.slice(0, 10).join(', ')}`);
  if (icp.competitors?.length) lines.push(`compares against: ${icp.competitors.slice(0, 6).join(', ')}`);
  if (icp.workarounds?.length) lines.push(`does it today by: ${icp.workarounds.slice(0, 4).join(' · ')}`);
  if (icp.use_cases?.length) lines.push(`needs it for: ${icp.use_cases.slice(0, 4).join(' · ')}`);
  return lines.join('\n');
}
