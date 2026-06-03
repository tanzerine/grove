/**
 * Single-call writer. No more research-JSON middleman:
 *   - Tavily gives us search results (URLs, titles, snippets)
 *   - Site profile gives us the business context + voice
 *   - One LLM call produces article markdown + meta in delimited sections
 *
 * Delimited-section output is FAR more reliable than nested JSON for streaming
 * LLMs. We only parse JSON where we actually need it (site profile, social).
 */
import { llmCall } from '../llm';
import { qualityRulesPrompt } from './quality-rules';
import type { SiteProfile } from './site-profile';
import type { SearchResult } from '../search';

export type WriterOutput = {
  blog_post: string;
  meta_title: string;
  meta_description: string;
  // book-keeping — what citations the writer had access to
  sources_provided: { url: string; title: string }[];
};

export async function runWriter(opts: {
  topic: string;
  profile: SiteProfile;
  sources: SearchResult[];
  kb?: string;
}): Promise<WriterOutput> {
  const { topic, profile, sources, kb = '' } = opts;
  const { business, voice } = profile;

  const sourcesBlock = sources.length
    ? sources.map((s, i) => `[${i + 1}] ${s.title}\n    ${s.url}\n    ${s.snippet}`).join('\n\n')
    : '(no live sources provided — work from training data; do not invent URLs)';

  const system = `You are a content writer for ${business.name}.

ABOUT THE BUSINESS — every example, reference, and angle should serve this audience
Name: ${business.name}
Industry: ${business.industry}
What they do: ${business.description}
Products/services: ${business.products_services.join(', ') || 'unknown'}
Target audience: ${business.target_audience}
Value props: ${business.value_props.join('; ') || 'unknown'}
Geography: ${business.geography}

VOICE
Persona: ${voice.persona}
Tone: ${voice.tone}
Register: ${voice.register}
${voice.vocabulary.length ? `Vocabulary they actually use: ${voice.vocabulary.join(', ')}` : ''}

THE ARTICLE MUST
- Be obviously relevant to ${business.name}'s business — not a generic article
- Speak directly to ${business.target_audience}
- Reference at least one product/service naturally where it fits
- Sound like a thoughtful expert in this space, not a content farm

FORMATTING — produce rich, scannable markdown
- ## for major sections, ### for subsections
- **bold** for key terms (3-6 per article max)
- *italic* sparingly for emphasis
- bulleted lists for parallel ideas, numbered lists for steps
- > blockquotes for punchy lines (1-3 per article)
- horizontal rules (---) at MAJOR argument shifts (0-2 per article)
- inline \`code\` for product names / technical terms when natural
- tables for clear comparisons (keep them simple)
- vary section length — don't make everything the same shape

CITATIONS
You will receive web search results below. Cite ONLY URLs from that list as inline
markdown links: [descriptive text](url). NEVER fabricate URLs. If a fact needs
verification and no provided source covers it, drop the fact.

${qualityRulesPrompt()}

${kb ? `CUSTOMER KNOWLEDGE BASE (weave specific details from this):\n${kb}\n` : ''}

CRITICAL OUTPUT FORMAT
Respond using EXACTLY these three sections, in this order, each on its own line
with three dashes. Do not add any text before, between, or after.

---BLOG_POST---
[the full markdown article]
---META_TITLE---
[under 60 chars]
---META_DESCRIPTION---
[under 155 chars]`;

  const user = `TOPIC / KEYWORD: ${topic}

WEB SEARCH RESULTS (your only allowed citation sources):
${sourcesBlock}

Write a blog post on this topic for ${business.name}. Pick the strongest angle
that's both relevant to ${business.target_audience} and not generic. Use the
search results as your evidence base — cite them inline.`;

  const { text } = await llmCall({ system, user, maxTokens: 6000 });
  const out = parseSections(text);

  // sanity: if the model ignored the format and produced one blob, treat the
  // whole thing as the body and synthesize a meta from the first heading.
  if (!out.blog_post && text.trim().length > 200) {
    out.blog_post = text.trim();
  }
  if (!out.meta_title && out.blog_post) {
    const h1 = out.blog_post.match(/^#\s+(.+)/m)?.[1];
    out.meta_title = (h1 ?? topic).slice(0, 60);
  }
  if (!out.meta_description && out.blog_post) {
    const firstPara = out.blog_post.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? '';
    out.meta_description = firstPara.replace(/[*_`#>]/g, '').slice(0, 155);
  }
  return { ...out, sources_provided: sources.map((s) => ({ url: s.url, title: s.title })) };
}

function parseSections(text: string): Omit<WriterOutput, 'sources_provided'> {
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
Each platform gets its own treatment — no copy-paste. Use ${business.name}'s tone:
${voice.persona}. ${voice.tone}.

CRITICAL OUTPUT FORMAT — use these exact delimiters, no other text:

---X---
[6-10 numbered tweets, hook first, threaded narrative]
---LINKEDIN---
[1500-2200 chars, story-led, line breaks every 1-2 sentences, no hashtag spam, end with a question]
---INSTAGRAM---
[Under 2200 chars, hook-driven, 3-5 hashtags at the end]`;

  const user = `ARTICLE TITLE: ${article.title}

ARTICLE BODY (markdown):
${article.body_md.slice(0, 8000)}`;

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
