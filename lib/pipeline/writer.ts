/**
 * Single-call writer with a self-correction pass.
 *
 * Pipeline:
 *   1. Draft article from system prompt + sources
 *   2. Post-process (banned phrases, [N] → markdown links, em-dash cap, dedupe)
 *   3. Validate
 *   4. IF specific E-E-A-T rules failed (first-person, sentence variety),
 *      do ONE surgical revision pass — fix just those issues, leave the rest
 *   5. Re-post-process, persist
 */
import { llmCall } from '../llm';
import { qualityRulesPrompt } from './quality-rules';
import { postProcess, appendSourcesIfThin, citationCount } from './post-process';
import { validatePost } from './validator';
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

  const fmt = (arr: typeof context.primary, offset: number) =>
    arr.map((s, i) => `[${offset + i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet}`).join('\n\n');

  const sourcesBlock = [
    '### Primary sources (table-stakes evidence)',
    context.primary.length ? fmt(context.primary, 0) : '(none)',
    '',
    '### Competitor / alternative angles (use for positioning)',
    context.competitor.length ? fmt(context.competitor, context.primary.length) : '(none)',
    '',
    '### Audience pain points (ground the article in real problems)',
    context.pain.length ? fmt(context.pain, context.primary.length + context.competitor.length) : '(none)',
  ].join('\n');

  const sysHeader = `You write articles for ${business.name}.

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
${voice.vocabulary.length ? `Vocabulary they actually use: ${voice.vocabulary.join(', ')}` : ''}`;

  const eatRules = `
E-E-A-T RULES — every article must satisfy ALL of these
[1] EXPERIENCE: The article MUST open with a first-person sentence. Examples:
    "I ran this experiment with…"
    "When I tested…"
    "After three projects helping ${business.target_audience} with this…"
    "I've spent the last year watching ${business.target_audience} struggle with…"
    If a real personal anecdote isn't possible, write from ${business.name}'s POV:
    "Working with hundreds of ${business.target_audience}, we've noticed…"
    NEVER open with "For the better part of a decade…", "In today's…", or any
    third-person framing.

[2] EXPERTISE: Include at least one specific concrete example — real product
    name, real number, real workflow. No vague "studies show".

[3] AUTHORITY: Cite at least 3 sources inline as markdown links
    [descriptive text](https://...) — never bare [1] [2] numbers.

[4] TRUSTWORTHINESS: Include at least one nuance/uncertainty admission
    ("but it depends on…", "this won't work if…", "the limit here is…").

PROSE RHYTHM (40%+ of sentences must be under 12 words)
- Every paragraph: at least one sentence under 8 words AND one over 20
- 15–25% of sentences start with And, But, So, Because
- Use 2–4 fragments per article ("Worth it." "Not always.")
- 1–2 single-sentence paragraphs for emphasis
- Maximum 2 em-dashes in the whole article — use commas otherwise

STRUCTURE
- ## major sections, ### subsections (vary section length — never all the same)
- Mix bulleted + numbered lists
- 1–3 > blockquotes for punchy claims
- Tables for comparisons (2–4 columns)
- 0–2 horizontal rules (---) at MAJOR argument shifts
- inline \`code\` for product names / technical terms

DO NOT
- DO NOT start with "Title:" / "Welcome back to…" / any meta intro
- DO NOT use: elevate, game-changer, unleash, robust, seamless, cutting-edge,
  next-level, transformative, leverage, delve, tapestry, myriad, synergy
- DO NOT use generic openers: "Now,", "Next,", "Additionally,", "Moreover,",
  "Furthermore,", "Importantly,", "Notably,"
- DO NOT use recycled stats ("85% watch without sound", etc.)`;

  const system = `${sysHeader}

${eatRules}

${qualityRulesPrompt()}

${kb ? `CUSTOMER KNOWLEDGE BASE (weave specific details from this):\n${kb}\n` : ''}

OUTPUT FORMAT — exact delimiters, nothing else:

---BLOG_POST---
[the article — starts with the first-person line]
---META_TITLE---
[under 60 chars — the article's own SEO headline, NOT the input topic]
---META_DESCRIPTION---
[under 155 chars]`;

  const user = `TOPIC: ${topic}

SOURCES (your only allowed citations — refer to them as inline [text](url) links):

${sourcesBlock}

Write a genuinely useful 900–1400 word article. Pick a sharp POV. Reference at
least one of ${business.name}'s products / services where natural. Open with
the first-person line — do not skip it.`;

  // ─── 1. first draft ───────────────────────────────────────────────────
  const draft = await llmCall({ system, user, maxTokens: 5500 });
  let parsed = parseSections(draft.text);
  let body = parsed.blog_post || draft.text.trim();
  body = postProcess(body, sources);

  // ─── 2. validate ──────────────────────────────────────────────────────
  let v = validatePost(body);

  // ─── 3. surgical revision pass if specific rules failed ───────────────
  const needsFirstPerson = v.issues.some((i) => i.startsWith('MISSING_EXPERIENCE'));
  const needsRhythm = v.issues.some((i) => i.startsWith('LOW_SENTENCE_VARIETY'));
  const needsCitations = citationCount(body) < 3 && sources.length > 0;

  if (needsFirstPerson || needsRhythm || needsCitations) {
    const fixes: string[] = [];
    if (needsFirstPerson) fixes.push(
      `- Rewrite ONLY the opening paragraph so the very first sentence is first-person ` +
      `("I tested…", "When I worked with…", "We've watched ${business.target_audience}…"). ` +
      `Do not change the rest of the article.`
    );
    if (needsRhythm) fixes.push(
      `- Add 5–8 short sentences (under 8 words) sprinkled throughout the article. ` +
      `Convert 2–3 of them into one-sentence paragraphs for emphasis. ` +
      `Aim for 40%+ of sentences under 12 words.`
    );
    if (needsCitations) fixes.push(
      `- The article has fewer than 3 inline markdown-link citations. ` +
      `Add citations as [descriptive text](url) using ONLY URLs from the sources list. ` +
      `Place them on at least 3 factual claims.`
    );

    const fixSys = `You revise a draft article to fix specific E-E-A-T issues.
Apply ONLY the listed fixes. Do not rewrite anything else. Keep the same
structure, headings, examples, and voice. Output the corrected article using
the same delimiters.`;
    const fixUser = `FIXES TO APPLY:
${fixes.join('\n')}

SOURCES (for any citations you add):
${sourcesBlock}

ORIGINAL DRAFT:

---BLOG_POST---
${body}
---META_TITLE---
${parsed.meta_title}
---META_DESCRIPTION---
${parsed.meta_description}

Output the revised article in the same delimited format.`;

    try {
      const revised = await llmCall({ system: fixSys, user: fixUser, maxTokens: 5500 });
      const revParsed = parseSections(revised.text);
      if (revParsed.blog_post && revParsed.blog_post.length >= 400) {
        body = postProcess(revParsed.blog_post, sources);
        if (revParsed.meta_title) parsed.meta_title = revParsed.meta_title;
        if (revParsed.meta_description) parsed.meta_description = revParsed.meta_description;
      }
    } catch (e) {
      console.error('writer revision pass failed (continuing with first draft):', e);
    }
  }

  // ─── 4. ensure thin citations get a Sources section ───────────────────
  body = appendSourcesIfThin(body, sources, 3);

  // ─── 5. derive title from body H1 when meta_title is missing or weak ──
  const h1 = body.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim();
  let title = parsed.meta_title?.trim() || '';
  if (!title || title.toLowerCase() === topic.toLowerCase() || title.length < 10) {
    title = h1 || topic;
  }
  title = title.slice(0, 60);

  let metaDesc = parsed.meta_description?.trim() || '';
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
