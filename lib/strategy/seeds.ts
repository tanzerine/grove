/**
 * Turn a site profile into terms people actually type into Google.
 *
 * ── The defect this fixes ──────────────────────────────────────────────────
 * `buildStrategy` seeded its keyword research straight from
 * `site_profile.business`: products_services, industry, value_props. Those
 * fields are LLM-extracted MARKETING COPY, not search phrases, and Google
 * Autocomplete returns nothing for marketing copy. Measured against production
 * profiles on 2026-09-05, every one of these returned ZERO suggestions:
 *
 *   "Autonomous AI blog writing"                    → 0
 *   "One-line embed blog hosting"                   → 0
 *   "Automated SEO strategy and topical clustering" → 0
 *   "Zero upkeep and no dashboards to babysit"      → 0
 *   "AI Marketing Software / B2B SaaS"              → 0
 *   "Brand style memory / custom style training"    → 0
 *   "Pay-as-you-bake pricing (no subscription bloat)" → 0
 *
 * while the head terms hiding inside them return a full list of ten:
 *
 *   "ai blog writing" · "blog hosting" · "seo strategy" · "topical clustering"
 *   "ai marketing software" · "b2b saas" · "background removal"
 *
 * So `gatherKeywordDemand` returned [] for grove's own domain, `demandBlock`
 * fell back to "(none captured — plan from the business profile)", and the
 * planner invented topics from the company's description of itself. That is
 * the whole causal chain behind a blog whose every recorded Search Console
 * query was its own brand name: nothing ever told the planner what real people
 * search for, so it wrote about the product.
 *
 * ── The rules, and why each one is here ───────────────────────────────────
 * Every rule below is a generalisation of a measured failure above, not a
 * guess about how marketers write. A seed that survives is short, is a noun
 * phrase, and is not the brand's own name.
 */
import type { SiteProfile } from '../pipeline/site-profile';
import { language, languageVerdict, normalizeLang, type LangCode, type Language } from '../language';
import { fastLlmCall } from '../llm';

/**
 * Autocomplete is a head-term service. Four words is the measured ceiling:
 * "AI 3D icon generator" (4) returns suggestions, "Brand style memory / custom
 * style training" (6) returns none — and the same cliff shows up in Korean,
 * where "AI 3D 아이콘 생성기" returns nothing but "3D 아이콘 생성" returns three.
 */
export const MAX_SEED_WORDS = 4;

/** Feature bullets join independent noun phrases; each half is its own query.
 *  "REST API for image generation" is two searchable things, not one. */
const CONNECTIVE = /\s*(?:[/,;·|]|\band\b|\bor\b|\bfor\b|\bwith\b|\bto\b|\bplus\b|\bacross\b|\bincluding\b)\s*/gi;

/**
 * Adjectives that lead a feature bullet and never lead a query. Somebody
 * searches "background removal", not "automatic background removal for
 * drop-in ready PNGs" — and certainly not "studio-grade".
 */
const LEAD_ADJECTIVE = new Set([
  'automatic', 'automated', 'autonomous', 'auto', 'instant', 'instantly',
  'smart', 'intelligent', 'seamless', 'effortless', 'easy', 'simple',
  'powerful', 'advanced', 'flexible', 'versatile', 'complete', 'full',
  'unlimited', 'zero', 'built-in', 'native', 'real-time', 'realtime',
  'fast', 'quick', 'rapid', 'studio-grade', 'enterprise-grade', 'high-fidelity',
  'one-line', 'one-click', 'drop-in', 'hands-free', 'custom', 'customisable',
  'customizable', 'personalised', 'personalized', 'dedicated', 'premium',
]);

/** Clauses that are pure scaffolding once the connectives are gone. */
const JUNK = new Set([
  'and', 'or', 'for', 'with', 'the', 'a', 'an', 'of', 'in', 'on', 'to',
  'no', 'not', 'your', 'our', 'my', 'you', 'we', 'it', 'that', 'this',
  'etc', 'more', 'other', 'others', 'across', 'per', 'via',
]);

/** Split a word run, keeping intra-word hyphens (b2b, drop-in, real-time). */
function words(s: string): string[] {
  return s.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
}

/**
 * One raw profile string → zero or more search-shaped candidates.
 * Exported for tests: each rule is easier to pin down in isolation.
 */
export function seedCandidates(raw: string): string[] {
  if (!raw) return [];

  // Parentheticals are always asides — "(no subscription bloat)", "(PNG, WEBP,
  // SVG, GLB)". Nobody searches the aside, and leaving it in guarantees a miss.
  const cleaned = raw.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  const clauses = cleaned.split(CONNECTIVE).filter((c) => c.trim());
  // A single-word clause means different things depending on where it came
  // from. If the WHOLE field was one word it is the business's own category
  // ("Bakery" → 10 useful suggestions). If it fell out of a longer sentence it
  // is a stray verb or noun — "Learns and replicates your exact brand voice"
  // yields "learns", which does return suggestions ("learns", "learnus") and
  // that is exactly the problem: they are real, and irrelevant. A fragment
  // pollutes the demand list rather than emptying it.
  const fromFragment = clauses.length > 1;

  const out: string[] = [];
  for (const clause of clauses) {
    let w = words(clause.toLowerCase());

    // Strip leading marketing adjectives while at least two words remain.
    // Measured: "custom style training" → 0 suggestions, "style training" → 10;
    // "automatic background removal" → 10, "background removal" → 10. Stripping
    // never cost yield and twice recovered it.
    while (w.length > 2 && LEAD_ADJECTIVE.has(w[0])) w = w.slice(1);

    if (!w.length || w.length > MAX_SEED_WORDS) continue;      // too long to autocomplete
    if (w.length === 1 && fromFragment) continue;              // stray word, see above
    if (w.every((x) => JUNK.has(x))) continue;
    const phrase = w.join(' ');
    if (phrase.length < 3) continue;                            // "x", "ai" alone
    if (!/\p{L}/u.test(phrase)) continue;                       // must contain letters
    out.push(phrase);
  }
  return out;
}

/** Does this phrase name the business itself? Brand queries are navigational —
 *  they have no demand until the brand does, and researching them is how a
 *  blog ends up writing about itself. */
export function isBrandTerm(phrase: string, brand: string | null | undefined): boolean {
  const b = (brand ?? '').toLowerCase().trim();
  if (b.length < 3) return false;                 // "AI", "Ov" — too generic to exclude on

  // Hyphens and dots are word separators here, so "grove-ai alternatives"
  // matches the same way "grove ai alternatives" does.
  const norm = ` ${phrase.toLowerCase().replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (norm.includes(` ${b.replace(/[-_.]+/g, ' ')} `)) return true;

  // "Grove" → "groveai": the brand glued to a suffix is still the brand. Length
  // bounded so a long unrelated phrase containing the letters is not caught.
  const squash = (x: string) => x.replace(/[\s\-_.]/g, '');
  const sq = squash(phrase.toLowerCase());
  return sq.includes(squash(b)) && sq.length <= squash(b).length + 6;
}

/*
 * Deliberately conservative: a phrase that contains the brand AS A WORD is
 * treated as a brand term even when it plainly isn't one ("olive grove
 * irrigation" for a company called Grove). Excluding a seed only costs one of
 * eight research slots; keeping a brand seed reproduces the exact failure this
 * module exists to prevent, because brand phrases have no demand until the
 * brand does. When the brand really is the topic, the profile's other fields
 * still carry it.
 */

/**
 * The seed terms to research, best first.
 *
 * Order is deliberate: products_services are noun phrases naming a thing
 * ("AI 3D icon generator"), industry names the category, and value_props are
 * claims about the thing ("Studio-grade lighting and quality") — the least
 * search-shaped of the three, which is why they come last rather than being
 * dropped. Callers cap with `limit`, so ordering decides what actually gets
 * researched when the cap bites.
 */
export function searchSeeds(
  profile: Pick<SiteProfile, 'business'> | null | undefined,
  opts: { limit?: number } = {},
): string[] {
  const biz = profile?.business;
  if (!biz) return [];
  const limit = opts.limit ?? 8;

  const sources = [
    ...(biz.products_services ?? []),
    biz.industry ?? '',
    ...(biz.value_props ?? []),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const src of sources) {
    for (const cand of seedCandidates((src ?? '').trim())) {
      if (isBrandTerm(cand, biz.name)) continue;
      if (seen.has(cand)) continue;
      seen.add(cand);
      out.push(cand);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * A dead seed's head noun phrase — the last two words.
 *
 * Autocomplete answers head terms, and the head of an English noun phrase sits
 * at the end. Measured on real profile output, this recovers three of the four
 * seeds that returned nothing:
 *
 *   "embed blog hosting"            → 0 …but "blog hosting"  → 10
 *   "content quality scoring agent" → 0 …but "scoring agent" → 10
 *   "brand style memory"            → 0 …but "style memory"  → 10
 *
 * Returns null when there is nothing to narrow (a two-word seed is already a
 * bigram, and "publishing integrations" simply has no demand — that is an
 * answer, not a failure).
 */
export function narrowSeed(seed: string): string | null {
  const w = words((seed ?? '').toLowerCase());
  if (w.length < 3) return null;
  return w.slice(-2).join(' ');
}

/* ────────────────────── seeds in the publication language ─────────────────
 *
 * `site_profile.business` is always written in English — the profiler runs in
 * English regardless of what the site publishes. So a Korean blog researched
 * English seeds, and `lib/language.ts` faithfully sent them to a Korean
 * autocomplete locale. Measured on the real oveners.com profile:
 *
 *   "Automatic background removal"  @hl=ko →  8 English suggestions
 *   "배경 제거"                       @hl=ko → 10 Korean suggestions
 *   "피그마 플러그인"                   @hl=ko → 10 Korean suggestions
 *
 * The English seeds do return something, which is why this went unnoticed:
 * the plan looked grounded while being grounded in the wrong market. What a
 * Korean reader types was never researched at all.
 *
 * CLAUDE.md already records that keyword research was made per-language — the
 * locale and the modifiers were. The SEEDS were not, and they are the input
 * everything else hangs off.
 */
/**
 * Parse a model's seed list. Pure, so the parsing and the guard below are
 * testable without a network.
 *
 * Rejects anything still in the wrong script — a small model asked to
 * translate will sometimes echo the English back, and English seeds sent to a
 * Korean locale is the exact bug being fixed.
 */
function inTargetScript(line: string, lang: LangCode): boolean {
  // For a CJK target this has to be decisive, and `languageVerdict` is not:
  // it is deliberately conservative and answers 'unsure' for a short Latin
  // string rather than guessing (CLAUDE.md records why). That is right for
  // judging an article and useless here — "background removal" would sail
  // through as a Korean seed, which is the entire bug. A seed is a few words,
  // so the presence of the script itself is the honest test.
  if (language(lang).script === 'cjk') return CJK.test(line);
  // Latin-script targets share an alphabet with English, so no such test
  // exists. Fall back to the conservative verdict and reject only a confident
  // 'wrong': a doubtful seed costs one request, dropping it costs a line of
  // research.
  return languageVerdict(line, lang) !== 'wrong';
}

/** Hangul, Han, kana — any character that cannot be English. */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

export function parseLocalizedSeeds(text: string, lang: LangCode, limit = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? '').split('\n')) {
    const line = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')   // list bullets
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();
    if (!line || line.length > 40) continue;
    if (!inTargetScript(line, lang)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Rewrite English seeds as the phrases this blog's readers actually type.
 *
 * No-ops for English (no call, no latency). Fail-soft in every other case:
 * any error, empty answer, or wrong-script answer returns the English seeds
 * unchanged, so the worst outcome is the behaviour that shipped before.
 */
export async function localizeSeeds(
  seeds: string[],
  lang: LangCode | Language,
): Promise<string[]> {
  const code = normalizeLang(typeof lang === 'string' ? lang : lang.code);
  if (code === 'en' || !seeds.length) return seeds;

  try {
    const { text } = await fastLlmCall({
      system:
        'You translate product keywords into the search phrases real people type into Google. ' +
        'Reply with one short phrase per line, no numbering, no commentary, no explanations.',
      // The instruction leads, for the reason recorded in CLAUDE.md under
      // Publication language: this model attends to the user turn.
      user:
        `Write each of these as the SHORT phrase someone would type into Google in ${code}. ` +
        `Keep each to 2-4 words. Do not translate literally — use the words searchers actually use. ` +
        `Output only the phrases, one per line.\n\n${seeds.join('\n')}`,
      maxTokens: 300,
    });
    const localized = parseLocalizedSeeds(text, code, seeds.length);
    return localized.length ? localized : seeds;
  } catch {
    return seeds;
  }
}
