/**
 * Programmatic SEO — generate a *set* of focused pages at once, each targeting
 * one real search query, instead of a single long article.
 *
 * The dataset is free and demand-validated: we reuse the keyword-demand module
 * (Google Autocomplete) to source the real phrases people search, then generate
 * a lean, genuinely-useful page per phrase. Pages are stored as ordinary posts,
 * so they inherit Grove's whole SEO stack for free — sitemap, JSON-LD, RSS,
 * embed, and render-time internal linking (which cross-links the cluster).
 *
 * This deliberately skips the heavyweight single-article pipeline (3k words +
 * manager rewrite loop). pSEO pages are short and answer-first; quality is
 * guarded by routing every page to human review before it can publish.
 */
import { llmCall, extractJson } from './llm';
import { gatherKeywordDemand, classifyIntent, type SearchIntent } from './strategy/keywords';
import type { SiteProfile } from './pipeline/site-profile';

export type PseoPageSpec = { keyword: string; intent: SearchIntent; title: string };
export type PseoPlan = { seed: string; pages: PseoPageSpec[] };

const MAX_PAGES = 12;

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Plan a programmatic set: pull demand for the seed, then turn the top phrases
 * into page specs with strong titles. Falls back to templated titles if the
 * titling model hiccups, and to seed-only specs if demand can't be gathered.
 */
export async function planProgrammaticSet(
  profile: SiteProfile,
  seed: string,
  count = 6,
): Promise<PseoPlan> {
  const n = Math.min(Math.max(count, 1), MAX_PAGES);
  const clean = seed.trim();

  const demand = await gatherKeywordDemand(
    [clean, ...(profile.business.products_services ?? [])],
    { maxSeeds: 3, limit: 40 },
  );

  // Prefer phrases that actually contain the seed so the set stays coherent.
  const seedLc = clean.toLowerCase();
  const ranked = [
    ...demand.filter((d) => d.keyword.toLowerCase().includes(seedLc)),
    ...demand.filter((d) => !d.keyword.toLowerCase().includes(seedLc)),
  ];
  const keywords = (ranked.length ? ranked.map((d) => d.keyword) : [clean]).slice(0, n);

  // One cheap LLM call turns the keyword list into specific, non-generic titles.
  let titles: Record<string, string> = {};
  try {
    const { text } = await llmCall({
      system: `You write specific, click-worthy but honest SEO page titles. Avoid "Ultimate Guide", "Everything You Need to Know", and year stamps. Output ONE raw JSON object: {"titles":[{"keyword","title"}]} — one entry per input keyword, title <= 65 chars.`,
      user: `Business: ${profile.business.name} (${profile.business.industry}). Audience: ${profile.business.target_audience}.\nWrite one page title per keyword below. The title must clearly target that exact search:\n${keywords.map((k) => `- ${k}`).join('\n')}`,
      json: true,
      maxTokens: 800,
      fast: true,
    });
    const arr = extractJson<{ titles?: Array<{ keyword: string; title: string }> }>(text).titles;
    if (Array.isArray(arr)) {
      for (const r of arr) if (r?.keyword && r?.title) titles[r.keyword.toLowerCase()] = r.title.trim();
    }
  } catch { /* fall back to templated titles below */ }

  const pages: PseoPageSpec[] = keywords.map((keyword) => ({
    keyword,
    intent: classifyIntent(keyword),
    title: titles[keyword.toLowerCase()] || titleCase(keyword),
  }));

  return { seed: clean, pages };
}

export type PseoPageContent = { meta_title: string; meta_description: string; body_md: string };

/**
 * Generate one lean, answer-first page for a single target keyword. One LLM
 * call; intent decides how the product shows up (editorial vs. a real CTA).
 */
export async function generateProgrammaticPage(
  profile: SiteProfile,
  spec: PseoPageSpec,
): Promise<PseoPageContent> {
  const productRule =
    spec.intent === 'transactional'
      ? `This is a buyer query — mention ${profile.business.name} as the obvious option where it genuinely fits, and end with a single, low-key CTA paragraph linking the reader to the product.`
      : spec.intent === 'commercial'
        ? `Mention ${profile.business.name} once, naturally, as one credible option among others. No hard sell, no closing CTA.`
        : `Keep it editorial — the page must be useful without ever pitching. Mention ${profile.business.name} only if it is truly the most natural example.`;

  const system = `You write concise, genuinely useful web pages that answer ONE specific search query completely.

RULES
- Open with a direct 2-3 sentence answer to the query. No "in today's world" throat-clearing.
- Then back it up: 3-5 short H2 sections with specifics, examples, and steps.
- End with a short FAQ: 2-3 real follow-up questions as "### Question" + a tight answer.
- 700-1000 words. Plain, confident, skimmable. Markdown only. No H1 (the title is rendered separately).
- ${productRule}

OUTPUT: one raw JSON object. No markdown fences. Keys: meta_title (<=60 chars), meta_description (<=155 chars), body_md.`;

  const user = `BUSINESS: ${profile.business.name} — ${profile.business.description}
Industry: ${profile.business.industry}. Audience: ${profile.business.target_audience}.
Value props: ${(profile.business.value_props ?? []).join('; ') || 'n/a'}

PAGE TITLE: ${spec.title}
TARGET SEARCH KEYWORD (the page must rank for this; use it naturally in the opening): "${spec.keyword}"
SEARCH INTENT: ${spec.intent}

Write the page as JSON now.`;

  const { text } = await llmCall({ system, user, json: true, maxTokens: 2200 });
  const parsed = extractJson<PseoPageContent>(text);

  // Guardrails so a malformed response never persists an empty page.
  if (!parsed.body_md || parsed.body_md.trim().length < 200) {
    throw new Error('programmatic page body too short');
  }
  parsed.meta_title = (parsed.meta_title || spec.title).slice(0, 70);
  parsed.meta_description = (parsed.meta_description || '').slice(0, 160);
  return parsed;
}
