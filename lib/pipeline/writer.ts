/**
 * Single-call article writer + on-demand social adapter.
 *
 * E-E-A-T enforcement strategy:
 *   - Prompt asks for first-person experience, varied rhythm, citations
 *   - Post-process pass mechanically strips banned phrases, caps em-dashes,
 *     converts [N] refs to markdown links, dedupes paragraphs
 *   - Validator runs after post-process; if it still fails the citation bar,
 *     we append a "Sources" section as a safety net
 */
import { llmCall } from '../llm';
import { qualityRulesPrompt } from './quality-rules';
import { postProcess, appendSourcesIfThin } from './post-process';
import type { SiteProfile } from './site-profile';
import type { ResearchContext } from './research-context';
import { flatSources } from './research-context';

export type WriterOutput = {
  blog_post: string;
  meta_title: string;
  meta_description: string;
  sources_provided: { url: string; title: string }[];
};

export async function runWriter(opts: {
  topic: string;
  profile: SiteProfile;
  context: ResearchContext;
  kb?: string;
}): Promise<WriterOutput> {
  const { topic, profile, context, kb = '' } = opts;
  const { business, voice } = profile;
  const sources = flatSources(context);

  const fmtSources = (arr: typeof context.primary, offset: number) =>
    arr.map((s, i) => `[${offset + i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet}`).join('\n\n');

  const sourcesBlock = [
    '### Primary sources (use for facts, definitions, evidence)',
    context.primary.length ? fmtSources(context.primary, 0) : '(none)',
    '',
    '### Competitor / alternative angles (use to position your point of view)',
    context.competitor.length ? fmtSources(context.competitor, context.primary.length) : '(none)',
    '',
    '### Audience pain points (use to ground the article in real problems)',
    context.pain.length ? fmtSources(context.pain, context.primary.length + context.competitor.length) : '(none)',
  ].join('\n');

  const system = `You write articles for ${business.name}.

ABOUT THE BUSINESS (every example, reference, and angle must serve this audience)
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
${voice.vocabulary.length ? `Vocabulary they actually use: ${voice.vocabulary.join(', ')}` : ''}

E-E-A-T RULES (not optional)
1. EXPERIENCE: Open the article with a first-person sentence — "I tested", "I ran",
   "what I saw when I tried", "in my experience working with ${business.target_audience}".
   If genuine first-person isn't possible, write the line from ${business.name}'s
   perspective: "When we ran this with our customers...". NEVER skip this.
2. EXPERTISE: Include one specific concrete example — a real product name, a real
   number, a real workflow. No vague "studies show".
3. AUTHORITATIVENESS: Cite at least 3 sources inline as markdown links
   [descriptive text](https://...) — never as bare [1] [2] numbers. Use the URLs
   from the sources block below; never invent.
4. TRUSTWORTHINESS: Include at least one nuance/uncertainty admission — "but
   it depends on…", "this won't work if…", "the limit here is…". Generic AI
   never hedges; humans always do.

ARTICLE STRUCTURE
- ## major sections, ### subsections
- Mix bulleted + numbered lists; vary section length deliberately
- 1–3 > blockquotes for punchy claims
- Tables for comparisons (simple, 2–4 columns)
- 0–2 horizontal rules (---) at MAJOR argument shifts
- inline \`code\` for product names / technical terms
- Bold key terms (max 6 times); italics sparingly

PROSE RHYTHM
- Every paragraph must have at least one sentence under 8 words AND one over 20
- 15–25% of sentences start with And, But, So, Because
- 2–4 sentence fragments per article ("Worth it." "Not always.")
- 1–2 single-sentence paragraphs for emphasis
- Maximum 2 em-dashes in the whole article — use commas otherwise

DO NOT
- DO NOT start the article with "Title:", "Welcome back to…", or any other meta intro.
  Open with the first-person experience sentence directly.
- DO NOT use the words: elevate, game-changer, unleash, robust, seamless,
  cutting-edge, next-level, transformative, leverage, delve, tapestry, myriad
- DO NOT use generic openers: "Now,", "Next,", "Additionally,", "Moreover,",
  "Furthermore,", "Importantly,", "Notably,"
- DO NOT use recycled stats ("85% watch without sound", "captions increase view time by 12%", etc.)
- DO NOT repeat paragraphs or sections

${qualityRulesPrompt()}

${kb ? `CUSTOMER KNOWLEDGE BASE (weave specific details from this):\n${kb}\n` : ''}

OUTPUT FORMAT — use these exact delimiters and NOTHING ELSE:

---BLOG_POST---
[the full markdown article — starts with first-person line, no "Title:" preamble]
---META_TITLE---
[under 60 chars]
---META_DESCRIPTION---
[under 155 chars]`;

  const user = `TOPIC: ${topic}

SOURCES (your only allowed citations — refer to them by URL in inline [text](url) links):

${sourcesBlock}

Write a genuinely useful article on this topic for ${business.target_audience}.
Pick a sharp, defensible point of view. Reference at least one of ${business.name}'s
products / services where natural. Aim for 900–1400 words.`;

  const { text } = await llmCall({ system, user, maxTokens: 5500 });
  const parsed = parseSections(text);

  let body = parsed.blog_post;
  if (!body || body.length < 200) {
    // model ignored sections — treat the whole response as body
    body = text.trim();
  }
  // mechanical fixes that the prompt can't reliably enforce
  body = postProcess(body, sources);
  body = appendSourcesIfThin(body, sources, 3);

  let title = parsed.meta_title;
  let metaDesc = parsed.meta_description;
  if (!title) {
    const h1 = body.match(/^#\s+(.+)/m)?.[1];
    title = (h1 ?? topic).slice(0, 60);
  }
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

OUTPUT FORMAT — use these exact delimiters and nothing else:

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
