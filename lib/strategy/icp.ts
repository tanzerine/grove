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
import { fastLlmCall, extractJson } from '../llm';
import type { SiteProfile } from '../pipeline/site-profile';
import { seedCandidates, isBrandTerm } from './seeds';
import { language, languageCommand, type LangCode } from '../language';

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
};

const EMPTY: CustomerProfile = {
  segments: [], jobs: [], pains: [], triggers: [], vocabulary: [], objections: [],
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
 * Infer the customer profile from the site profile.
 *
 * `fastLlmCall` rather than the strategy model: this is extraction and
 * re-registering, not planning, and it runs before the plan's own budget is
 * spent. Fail-soft — an empty profile makes the caller fall back to the
 * profile-derived seeds rather than skipping the month.
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
- If the business serves several distinct groups, give at most 4 segments.`;

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
  "objections": ["what stops them committing"]
}`;

  try {
    const { text } = await fastLlmCall({ system, user, maxTokens: 1200 });
    return normalizeIcp(extractJson<unknown>(text));
  } catch {
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
  return lines.join('\n');
}
