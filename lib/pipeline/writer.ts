import { llmCall } from '../llm';
import { qualityRulesPrompt } from './quality-rules';
import type { Research } from './research';
import type { SiteProfile } from './site-profile';

export type WriterOutput = {
  blog_post: string;
  meta_title: string;
  meta_description: string;
};

/**
 * Writes ONLY the article + SEO meta. Social variants are generated separately,
 * on demand, after the user approves the article (saves tokens on rejected drafts).
 */
export async function runWriter(research: Research, profile: SiteProfile, kb = ''): Promise<WriterOutput> {
  const business = profile.business;
  const voice = profile.voice;

  const system = `You are a content writer producing a blog post for ${business.name}.

ABOUT THE BUSINESS (use this for every example, reference, and angle)
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
${voice.vocabulary.length ? `Distinctive vocabulary: ${voice.vocabulary.join(', ')}` : ''}

THE ARTICLE MUST:
- Be obviously relevant to ${business.name}'s actual business (${business.industry})
- Speak directly to ${business.target_audience}
- Reference at least one of their products/services where natural
- Not feel like a generic article that could be on anyone's blog

${qualityRulesPrompt()}

CITATIONS
You have a research brief with citations. Use ONLY those URLs — never invent.
Cite inline as [text](url). Drop unverifiable facts.

${kb ? `CUSTOMER KNOWLEDGE BASE (weave specific details from this):\n${kb}\n` : ''}`;

  const user = `RESEARCH BRIEF:
${JSON.stringify(research, null, 2)}

Write the blog post following the outline. Use information gain hooks as the main differentiation.
The post must clearly serve ${business.name}'s readers — not a generic audience.

After the blog post, in the same response, generate:
- META_TITLE (under 60 chars, includes brand or specific topic)
- META_DESCRIPTION (under 155 chars)

Format response EXACTLY:

---BLOG_POST---
[full markdown blog post]

---META_TITLE---
[title]

---META_DESCRIPTION---
[description]`;

  const { text } = await llmCall({ system, user, maxTokens: 6000 });
  return parseSections(text);
}

function parseSections(text: string): WriterOutput {
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
  const system = `You adapt a single published article into native posts for X, LinkedIn, and Instagram.
Each platform gets its own voice — no copy-paste. Use ${business.name}'s tone:
${voice.persona}. ${voice.tone}.`;

  const user = `ARTICLE TITLE: ${article.title}
ARTICLE BODY (markdown):
${article.body_md.slice(0, 8000)}

Output EXACTLY:

---X---
[6-10 numbered tweets, hook first. Use the thread to tell the story, not just list points.]

---LINKEDIN---
[1500-2200 chars, story-led, line breaks every 1-2 sentences, no hashtag spam, ends with a question.]

---INSTAGRAM---
[Under 2200 chars, hook-driven, 3-5 hashtags at the end.]`;

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
