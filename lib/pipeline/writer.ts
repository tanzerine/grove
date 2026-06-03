/**
 * Article writer — takes the refined editorial brief (NOT the raw topic) and
 * produces the body + meta. The brief has already chosen the angle, title,
 * format, and first-person opener. The writer's job is to execute on it.
 */
import { llmCall } from '../llm';
import { qualityRulesPrompt } from './quality-rules';
import { postProcess, capCitations } from './post-process';
import type { SiteProfile } from './site-profile';
import type { ResearchContext } from './research-context';
import { flatSources } from './research-context';
import type { RefinedBrief } from './topic-refiner';

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
}): Promise<WriterOutput> {
  const { brief, profile, context, kb = '' } = opts;
  const { business, voice } = profile;
  const sources = flatSources(context);

  const fmt = (arr: typeof context.primary, offset: number) =>
    arr.map((s, i) => `[${offset + i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet}`).join('\n\n');

  const sourcesBlock = [
    '### Primary sources (use for facts, definitions, evidence)',
    context.primary.length ? fmt(context.primary, 0) : '(none)',
    '',
    '### Competitor / alternative angles (for positioning your POV)',
    context.competitor.length ? fmt(context.competitor, context.primary.length) : '(none)',
    '',
    '### Audience pain points (ground the article in real problems)',
    context.pain.length ? fmt(context.pain, context.primary.length + context.competitor.length) : '(none)',
  ].join('\n');

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

EDITORIAL BRIEF (the spec — execute on this exactly)
Title: ${brief.title}
Angle / thesis: ${brief.angle}
Format: ${brief.format}
Opening hook to use: "${brief.hook}"
Promise to deliver: ${brief.promise}
Specific details to weave in:
${brief.must_include.map((m) => `- ${m}`).join('\n') || '(none specified)'}

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
[the article — open with the hook line, # heading is the brief's title, 900–1400 words]
---META_TITLE---
[the brief's title, under 60 chars]
---META_DESCRIPTION---
[under 155 chars — capture the promise]`;

  const user = `SOURCES (your only allowed citations — inline as [text](url) markdown links):

${sourcesBlock}

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
  body = postProcess(body, sources);
  // cap citations: 4 max, extras demoted to plain text
  body = capCitations(body, 4);

  // Title: always prefer the editorial brief's title — that's the whole point
  const title = (parsed.meta_title?.trim() || brief.title).slice(0, 80);
  let metaDesc = parsed.meta_description?.trim() || brief.promise.slice(0, 155);
  if (!metaDesc) {
    const firstPara = body.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
    metaDesc = firstPara.replace(/[*_`#>]/g, '').slice(0, 155);
  }

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
    meta_title: out['meta_title'] ?? '',
    meta_description: out['meta_description'] ?? '',
  };
}

/* ─────────────────────────── ON-DEMAND SOCIAL ─────────────────────────── */

export type SocialOutput = { x: string; linkedin: string; instagram: string };

export async function runSocialAdapter(
  article: { title: string; body_md: string },
  profile: SiteProfile,
): Promise<SocialOutput> {
  const { business, voice } = profile;
  const system = `You adapt one article into native posts for X, LinkedIn, and Instagram.
Each platform gets its own treatment — no copy-paste. Voice: ${voice.persona}. ${voice.tone}.
Write for ${business.name}'s audience: ${business.target_audience}.

OUTPUT FORMAT — exact delimiters, nothing else:

---X---
[6–10 numbered tweets, hook first, threaded narrative]
---LINKEDIN---
[1500–2200 chars, story-led, line breaks every 1–2 sentences, no hashtag spam, end with a question]
---INSTAGRAM---
[Under 2200 chars, hook-driven, 3–5 hashtags at the end]`;

  const user = `ARTICLE TITLE: ${article.title}\n\nARTICLE BODY:\n${article.body_md.slice(0, 8000)}`;
  const { text } = await llmCall({ system, user, maxTokens: 3000 });

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
    x: out['x'] ?? '',
    linkedin: out['linkedin'] ?? '',
    instagram: out['instagram'] ?? '',
  };
}
