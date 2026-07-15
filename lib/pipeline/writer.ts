/**
 * Article writer — takes the refined editorial brief (NOT the raw topic) and
 * produces the body + meta. The brief has already chosen the angle, title,
 * format, and first-person opener. The writer's job is to execute on it.
 */
import { llmCall, extractJson } from '../llm';
import { deriveMetaDescription, capTitle } from '../meta';
import { qualityRulesPrompt } from './quality-rules';
import {
  postProcess, capCitations, ensureHomepageCta, forceCanonicalH1,
  ensureTakeaways, ensureFaqSection,
} from './post-process';
import type { SiteProfile } from './site-profile';
import type { ResearchContext } from './research-context';
import { flatSources } from './research-context';
import type { RefinedBrief, MarketingIntent } from './topic-refiner';

/**
 * Per-intent marketing rules block. The funnel position decides whether
 * the article is pure editorial, lightly contextual, or a direct conversion play.
 */
function marketingRulesFor(
  intent: MarketingIntent,
  business: SiteProfile['business'],
  homeUrl: string,
): string {
  const audienceLine = `Frame the article so a reader of ${business.target_audience} sees themselves in every example. NO hobbyist, off-target, or adjacent-persona examples (e.g. don't pitch "interior design" if the audience is product designers shipping UI). Every concrete example, anecdote, and "imagine if..." scenario must come from ${business.target_audience}'s actual day, not generic.`;

  if (intent === 'editorial') {
    return `MARKETING RULES (pure editorial — this article earns trust by NOT pitching)
- ${audienceLine}
- DO NOT mention "${business.name}" by name anywhere in the body.
- DO NOT link to ${homeUrl || 'the homepage'} or any owned property.
- DO NOT end with a CTA, "next steps", or "if you want to learn more" paragraph.
- The article ends on its argument. The reader walks away smarter, not pitched.
- You may reference the product CATEGORY generically when it's relevant ("AI icon generators", "site profilers", etc.) but never a specific brand including ours.`;
  }

  if (intent === 'conversion') {
    return `MARKETING RULES (conversion intent — the product genuinely IS the answer to this topic)
- ${audienceLine}
- Name "${business.name}" in the opening 200 words, in a sentence that frames the article's problem from the product's vantage point. Make the brand name itself a link: [${business.name}](${homeUrl || 'https://example.com'}).
- Reference ONE specific feature from {${business.products_services.join(', ') || 'their core product'}} mid-article, as the obvious tool a working reader would reach for at the moment the article introduces the problem it solves.
- Close with ONE deliberate CTA paragraph (2–3 sentences) that connects the article's lesson to ${business.name} as the next concrete step. The CTA should:
  • Use a verb that matches what the reader would actually do (open, generate, sketch, ship, bake) — not generic "try" or "sign up".
  • End with the brand-name-as-link: [${business.name}](${homeUrl || 'https://example.com'}).
  • Be ONE paragraph, not a separate H2 section. No "Conclusion" or "Get Started" heading.
- DO NOT use the phrases: "click here", "sign up today", "join us", "limited time", "don't miss out", "what are you waiting for".`;
  }

  // contextual (default)
  return `MARKETING RULES (contextual — subtle, this is editorial, not a landing page)
- ${audienceLine}
- Mention "${business.name}" exactly ONCE in the body, inline, the first time you reference the product category in a way that calls for a concrete example. The brand name itself is the link — markdown form: [${business.name}](${homeUrl || 'https://example.com'}). Examples of good placement:
  • "...which is the bet we made when we built [${business.name}](${homeUrl || ''})."
  • "We hit the same wall building [${business.name}](${homeUrl || ''}) — here's what worked."
  Bad placement: any sentence containing "try", "check out", "sign up", "click here", or a separate closing CTA paragraph.
- DO NOT add a closing "Want to learn more? Try X" paragraph. The article ends on its argument, not on a pitch.
- DO NOT use the words "try", "check out", "get started", "sign up", "join us", or "visit our" anywhere near the brand link.
- Reference ONE specific feature from {${business.products_services.join(', ') || 'their core product'}} inline only if it's the obvious answer to a problem the paragraph just described — as the tool a working reader would reach for, never as a product callout.`;
}

export type WriterOutput = {
  blog_post: string;
  meta_title: string;
  meta_description: string;
  sources_provided: { url: string; title: string }[];
};

export async function runWriter(opts: {
  brief: RefinedBrief;
  profile: SiteProfile;
  context: ResearchContext;
  kb?: string;
  hostname?: string;
  managerNotes?: string;       // present on rewrite passes
  previousDraft?: string;       // present on rewrite passes
}): Promise<WriterOutput> {
  const { brief, profile, context, kb = '', hostname, managerNotes, previousDraft } = opts;
  const { business, voice } = profile;
  const homeUrl = hostname ? `https://${hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : '';
  const sources = flatSources(context);

  const fmt = (arr: typeof context.primary, offset: number) =>
    arr.map((s, i) => `[${offset + i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet}`).join('\n\n');

  const sourcesBlock = [
    '### Primary sources (use for facts, definitions, evidence)',
    context.primary.length ? fmt(context.primary, 0) : '(none)',
    '',
    '### Competitor / alternative angles (POSITIONING INTEL ONLY — never name, link, cite, or recommend these in the article)',
    context.competitor.length ? fmt(context.competitor, context.primary.length) : '(none)',
    '',
    '### Audience pain points (ground the article in real problems)',
    context.pain.length ? fmt(context.pain, context.primary.length + context.competitor.length) : '(none)',
  ].join('\n');

  const faqBlock = (brief.faq_questions ?? []).length
    ? brief.faq_questions.map((q) => `  - ${q}`).join('\n')
    : '  - (none supplied — write 2–3 genuinely useful Q&As a reader of this topic would ask)';

  const serpSubtopics = context.serp?.subtopics ?? [];
  const serpBlock = serpSubtopics.length
    ? `\nSERP COVERAGE (real analysis of the live top-ranking pages — they all cover these subtopics). Address the relevant ones so the article is competitive, THEN beat this generic consensus with first-hand specifics, a sharper stance, or a gap none of them fill. Do NOT just mirror the list, and never name or link a competitor:\n${serpSubtopics.map((s) => `- ${s}`).join('\n')}\n`
    : '';

  const system = `You write articles for ${business.name}'s blog.
You're given a tight editorial brief — your job is to execute it. Don't
second-guess the title or angle; deliver on them.

ABOUT THE BUSINESS (every example, reference, and anecdote must serve this audience)
Name: ${business.name}
Industry: ${business.industry}
What they do: ${business.description}
Products / services: ${business.products_services.join(', ') || 'unknown'}
Target audience: ${business.target_audience}
Value props: ${business.value_props.join('; ') || 'unknown'}
Geography: ${business.geography}

VOICE
Persona: ${voice.persona}
Tone: ${voice.tone}
Register: ${voice.register}
${voice.vocabulary.length ? `Vocabulary they use: ${voice.vocabulary.join(', ')}` : ''}
${voice.we_are?.length ? `We ARE: ${voice.we_are.join('; ')}` : ''}
${voice.we_are_not?.length ? `We are NOT: ${voice.we_are_not.join('; ')}` : ''}
${voice.signature_moves?.length ? `Signature moves: ${voice.signature_moves.join('; ')}` : ''}
${voice.avoid?.length ? `Never say (brand-specific bans): ${voice.avoid.join(', ')}` : ''}
${voice.samples?.length ? `
VOICE ANCHORS — these are REAL excerpts from this brand's own blog. Match this
rhythm, diction, and attitude. Do NOT copy their content; imitate how they sound.
This is the bar: if your draft doesn't sound like it could sit next to these, rewrite it.
${voice.samples.map((s, i) => `--- anchor ${i + 1} ---\n${s}`).join('\n\n')}
` : ''}

EDITORIAL BRIEF (the spec — execute on this exactly)
Title: ${brief.title}
Angle / thesis: ${brief.angle}
Format: ${brief.format}
Opening hook to use: "${brief.hook}"
Promise to deliver: ${brief.promise}
Specific details to weave in:
${brief.must_include.map((m) => `- ${m}`).join('\n') || '(none specified)'}
Reader questions the FAQ must resolve (real search demand — answer these):
${faqBlock}

EXECUTION RULES (in priority order)
1. Use the title above verbatim as the H1 of the article.
2. Start the article body with the opening hook above (first-person — I/We/Our).
3. Weave in EVERY item from "Specific details to weave in" naturally.
4. Match the chosen format (${brief.format}):
   - experiment       → recount a comparison run, with what you tested + numbers
   - guide            → opinionated rules, not exhaustive — pick 3–7 strong points
   - opinion          → take a stance, defend it, address counterargument
   - launch           → concrete benefit framing, no hype words
   - curation         → numbered list of selected things, with reasoning
   - roadmap          → transparent share of what's next + honest hedging
   - behind-the-scenes → process story, what we tried, what didn't work
   - list             → numbered list, 5–10 items, each with a specific reason
   - tutorial         → step-by-step walkthrough of the named feature/service. Numbered
                        steps under "## Step N:" style headings; each step = the exact
                        action, what the reader should see when it works, and one
                        pitfall or tip. Steps come from the CUSTOMER KNOWLEDGE BASE —
                        never invent a step, flag, or menu the docs don't describe.
                        A reader following along must be able to finish.
   - deep-dive        → one named feature examined properly: what it does, how it
                        works underneath, why it's designed that way, when to reach
                        for it (and when not). Ground every capability claim in the
                        CUSTOMER KNOWLEDGE BASE; no invented internals.

${marketingRulesFor(brief.marketing_intent, business, homeUrl)}

EDITORIAL DESIGN (give the article rhythm and visual interest)
- Open with a 1–2 sentence LEAD paragraph that's short, punchy, and italicized using markdown *emphasis* — it sets the stakes before the real opening hook lands.
- Drop ONE pull quote mid-article: a > blockquote on a single, sharp claim from the surrounding paragraph (≤ 16 words). Place it after the first major section, not at the end. Don't quote yourself attributing — just the line itself.
- Use H2 for major sections and H3 for sub-points. Every H2 section should be roughly 150–300 words — vary length deliberately.
- Use one --- horizontal rule at the strongest argument shift (not as a section delimiter — as a beat).
- Use **bold** to surface 3–5 key phrases readers should catch when scanning, not to shout. No bolding entire sentences.
- Where you have 3+ parallel items, use a list. Where you have comparable options, use a 2–3 column table. Don't force either.
- One sentence per line in the lead and pull quote. Paragraphs of 2–4 sentences elsewhere, except for 1–2 single-sentence paragraphs used as emphasis beats.

E-E-A-T RULES (not optional)
- EXPERIENCE: open with first-person; reference doing/seeing/building, not summarizing
- EXPERTISE: include at least one concrete specific (real product, real number, real workflow)
- AUTHORITY (citations — be selective):
  - 3–4 inline citations TOTAL, no more
  - Cite ONLY when the claim genuinely needs evidence: a specific number,
    a year, a direct quote, a specific stat, a regulatory rule, a study finding
  - DO NOT cite for general statements, opinions, common knowledge, or
    "as everyone knows" framing
  - Inline as [descriptive text](url), never bare [N] numeric refs
  - If a sentence reads fine without a citation, drop it
- TRUSTWORTHINESS: include 1+ honest hedge ("but it depends…", "this won't work if…")

ANSWER-ENGINE OPTIMIZATION (AEO/GEO — how AI search & featured snippets pick you up)
- TL;DR: right after the opening hook (before the first H2), add a line "**Key takeaways**"
  followed by 3–5 tight bullets, each ≤ 15 words, stating the article's ACTUAL conclusions —
  the lines a reader (or an AI assistant) could quote standalone. Be specific
  ("Paper filters trap oils, so the cup tastes cleaner"), never a teaser ("we'll explore taste").
- ANSWER-FIRST: in the 1–2 most important H2 sections, the FIRST 1–2 sentences are a
  direct, self-contained answer (≤ 50 words) to that section's implied question — THEN
  elaborate. Write it so it still makes sense quoted out of context. Don't open with "it depends".
- STAT DENSITY: include at least 2 concrete, checkable numbers (a year, a count, a %, a
  measured result), each with its inline source link. Specific cited stats are what AI
  engines actually quote.
- FAQ: end the article with a section headed exactly "## FAQ". Answer EACH reader question
  from the brief as a "### <question>" heading followed by a tight 40–80 word answer that
  resolves it directly and stands alone. 2–4 Q&As.
- If the marketing rules call for a closing CTA paragraph, it goes RIGHT BEFORE "## FAQ"
  so the FAQ stays the final section.
- Stay informational, not salesy, in the body — answer engines demote promotional tone.
  (The brand placement is already specified in the marketing rules; don't add more.)

PROSE RHYTHM (40%+ of sentences must be under 12 words)
- Every paragraph: at least one sentence under 8 words AND one over 20
- 15–25% of sentences start with And, But, So, Because
- Use 2–4 fragments per article ("Worth it." "Not always.")
- 1–2 single-sentence paragraphs for emphasis
- Maximum 2 em-dashes total — use commas otherwise

STRUCTURE
- ## major sections, ### subsections (vary section length deliberately)
- Mix bulleted + numbered lists
- 1–3 > blockquotes for punchy claims
- Tables for comparisons (2–4 columns)
- 0–2 horizontal rules (---) at MAJOR argument shifts
- inline \`code\` for product names / technical terms

LENGTH (non-negotiable)
- 900–1400 words for the main body, PLUS the short FAQ (2–4 Q&As). A draft under
  800 words will be auto-rejected as thin.
  Don't pad — go deeper: more concrete detail per section, not more sections.

NEVER SEND THE READER ELSEWHERE
- This is ${business.name}'s OWN blog. Never name, link, recommend, or compare
  by name any competing product, tool, platform, studio, or agency — not even
  to look balanced. The "Competitor / alternative angles" sources are for
  sharpening YOUR contrast only.
- Banned constructions: "tools like X", "platforms like Y", "you could also
  use…", "alternatively, try…", "partner with an agency", "hire a studio".
- You may name the product CATEGORY generically ("AI icon generators"); never
  a specific rival brand.

H1
- The article's one and only H1 (# ) must be the brief's Title VERBATIM.
  Do not rewrite it, shorten it, or invent a different headline.

DO NOT
- DO NOT start with "Title:", "Welcome back to…", or any meta intro
- DO NOT use: elevate, game-changer, unleash, robust, seamless, cutting-edge,
  next-level, transformative, leverage, delve, tapestry, myriad, synergy
- DO NOT use generic openers: "Now,", "Next,", "Additionally,", "Moreover,",
  "Furthermore,", "Importantly,", "Notably,"
- DO NOT use recycled stats ("85% watch without sound", etc.)
- DO NOT repeat paragraphs

${qualityRulesPrompt()}

${kb ? `CUSTOMER KNOWLEDGE BASE (weave specific details from this):\n${kb}\n` : ''}

OUTPUT FORMAT — exact delimiters, nothing else:

---BLOG_POST---
[the article — open with the hook line, # heading is the brief's title, 900–1400 words, ending with the ## FAQ section]
---KEY_TAKEAWAYS---
[the same 3–5 "Key takeaways" bullets from the article, one "- " bullet per line, each ≤ 15 words]
---FAQ---
[the same FAQ from the article: each Q&A as a "### <question>" heading followed by its 40–80 word answer]
---META_TITLE---
[the brief's title verbatim]
---META_DESCRIPTION---
[under 155 chars — capture the promise]`;

  const rewriteBlock = managerNotes && previousDraft
    ? `\n\nMANAGER REWRITE — this is round 2. Apply the notes surgically; keep what works.\n${managerNotes}\n\nPREVIOUS DRAFT (edit this — don't restart from scratch):\n${previousDraft.slice(0, 9000)}\n`
    : '';

  const user = `SOURCES (your only allowed citations — inline as [text](url) markdown links):

${sourcesBlock}
${serpBlock}${rewriteBlock}
Deliver the article now. Open with the hook line verbatim. Use the title as your H1.`;

  // ─── single LLM draft. No revision pass on the hot path. ─────────────
  // Why: two LLM calls back-to-back can push past Vercel's 300s ceiling and
  // leave posts stuck in 'writing'. The validator still runs and exposes
  // any issues in the review UI — fix manually or with the future "Polish"
  // button instead of risking a hang here.
  console.log('[writer] calling LLM (single draft, no revision)');
  const draft = await llmCall({ system, user, maxTokens: 4000 });
  console.log('[writer] LLM returned, len:', draft.text.length);

  const parsed = parseSections(draft.text);
  let body = parsed.blog_post || draft.text.trim();
  // Canonical title is decided here (brief wins) so we can force it onto the H1.
  // The brief's full title, capped only at a word boundary — a hard .slice(80)
  // shipped mid-word titles ("…Designers Swi") to live blogs.
  const title = capTitle(brief.title?.trim() || parsed.meta_title?.trim() || '');
  body = postProcess(body, sources);
  // force the H1 to the canonical title verbatim (prompt rule #1, now guaranteed)
  body = forceCanonicalH1(body, title);
  // cap citations: 4 max, extras demoted to plain text
  body = capCitations(body, 4);
  // marketing safety net — funnel-aware: editorial=no-op, contextual=inline link,
  // conversion=inline link + closing CTA paragraph.
  body = ensureHomepageCta(body, {
    businessName: business.name,
    hostname,
    intent: brief.marketing_intent,
  });
  // AEO safety net — models routinely skip the in-body "Key takeaways" and FAQ
  // (0 of the first 28 published posts had takeaways, 1 had a FAQ, despite the
  // prompt demanding both). They follow OUTPUT delimiters far more reliably, so
  // we collect the blocks as sections and splice them in when the body lacks
  // them; the CTA is already in place, so the FAQ still lands last.
  body = ensureTakeaways(body, parsed.key_takeaways);
  body = ensureFaqSection(body, parsed.faq);

  // Title already computed above (canonical, forced onto the H1).
  // Prefer a usable model description; otherwise fall back to the strongest
  // standalone line (first Key Takeaway → promise → opening para), capped so
  // Google won't truncate mid-word.
  const metaDesc = deriveMetaDescription({
    modelMeta: parsed.meta_description,
    body,
    promise: brief.promise,
  });

  return {
    blog_post: body,
    meta_title: title,
    meta_description: metaDesc,
    sources_provided: sources.map((s) => ({ url: s.url, title: s.title })),
  };
}

function parseSections(text: string) {
  const out: Record<string, string> = {};
  let cur: string | null = null;
  const buf: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^---(\w+)---\s*$/);
    if (m) {
      if (cur) out[cur.toLowerCase()] = buf.join('\n').trim();
      cur = m[1];
      buf.length = 0;
    } else buf.push(line);
  }
  if (cur) out[cur.toLowerCase()] = buf.join('\n').trim();
  return {
    blog_post: out['blog_post'] ?? '',
    key_takeaways: out['key_takeaways'] ?? '',
    faq: out['faq'] ?? '',
    meta_title: out['meta_title'] ?? '',
    meta_description: out['meta_description'] ?? '',
  };
}

/* ─────────────────────────── ON-DEMAND SOCIAL ─────────────────────────── */

export type SocialOutput = { x: string; linkedin: string; instagram: string };

/**
 * Parse the social adapter's LLM output. Primary format is JSON (via the
 * same fence-tolerant extractJson every other pipeline step uses); the legacy
 * ---X--- delimiter format stays as a fallback. Throws when every channel
 * comes out empty — silently persisting blanks is how "Write social posts"
 * once returned ok:true while writing nothing.
 */
export function parseSocialOutput(text: string): SocialOutput {
  let out: Partial<Record<keyof SocialOutput, unknown>> = {};
  try {
    out = extractJson<Partial<SocialOutput>>(text);
  } catch {
    // Legacy delimiters, parsed leniently: any case, 2+ dashes, optional
    // **bold**/backtick/heading decoration around ---x--- etc.
    const parsed: Record<string, string> = {};
    let cur: string | null = null;
    const buf: string[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/^[\s*_`>#]*-{2,}\s*(x|linkedin|instagram)\s*-{2,}[\s*_`]*$/i);
      if (m) {
        if (cur) parsed[cur] = buf.join('\n').trim();
        cur = m[1].toLowerCase();
        buf.length = 0;
      } else buf.push(line);
    }
    if (cur) parsed[cur] = buf.join('\n').trim();
    out = parsed;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const result = { x: str(out.x), linkedin: str(out.linkedin), instagram: str(out.instagram) };
  if (!result.x && !result.linkedin && !result.instagram) {
    throw new Error(`social adapter returned no channel copy. First 200 chars: ${text.slice(0, 200)}`);
  }
  return result;
}

export async function runSocialAdapter(
  article: { title: string; body_md: string },
  profile: SiteProfile,
): Promise<SocialOutput> {
  const { business, voice } = profile;
  const system = `You adapt one article into native posts for X, LinkedIn, and Instagram.
Each platform gets its own treatment — no copy-paste. Voice: ${voice.persona}. ${voice.tone}.
Write for ${business.name}'s audience: ${business.target_audience}.

Return JSON only — no prose around it:
{
  "x": "6–10 numbered tweets, hook first, threaded narrative, separated by newlines",
  "linkedin": "1500–2200 chars, story-led, line breaks every 1–2 sentences, no hashtag spam, end with a question",
  "instagram": "under 2200 chars, hook-driven, 3–5 hashtags at the end"
}`;

  const user = `ARTICLE TITLE: ${article.title}\n\nARTICLE BODY:\n${article.body_md.slice(0, 8000)}`;
  const { text } = await llmCall({ system, user, json: true, maxTokens: 3000 });
  return parseSocialOutput(text);
}
