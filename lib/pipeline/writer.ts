import { anthropic, MODEL } from '../anthropic';
import { qualityRulesPrompt } from './quality-rules';
import type { Research } from './research';

export type Voice = {
  persona: string;
  tone: string;
  register: string;
  vocabulary?: string[];
};

export const DEFAULT_VOICE: Voice = {
  persona: 'B2B SaaS founder writing tactically for other founders',
  tone: 'direct, contrarian when warranted, data-driven, wry but not jokey',
  register: 'professional-conversational, no academic jargon',
};

export type WriterOutput = {
  blog_post: string;
  meta_title: string;
  meta_description: string;
  x_thread: string;
  linkedin_post: string;
  instagram_caption: string;
};

export async function runWriter(research: Research, voice: Voice = DEFAULT_VOICE, kb = ''): Promise<WriterOutput> {
  const system = `You are a content writer producing a blog post that satisfies Google E-E-A-T.

VOICE
Persona: ${voice.persona}
Tone: ${voice.tone}
Register: ${voice.register}

${qualityRulesPrompt()}

WORKFLOW
Write the post section by section. After each section, silently check:
did I use any AI-pattern sentences? Adjust the next section.

Before writing any numeric claim, use web_search to verify it. Never publish an
unverified number. If you can't verify, drop the claim.

If a customer knowledge base is provided, weave specific facts/quotes from it.`;

  const kbSection = kb ? `\n\nCUSTOMER KNOWLEDGE BASE (use specific details from this):\n${kb}\n` : '';
  const user = `RESEARCH BRIEF:
${JSON.stringify(research, null, 2)}
${kbSection}

Write the blog post following the outline. Use information gain hooks as the main differentiation.
Cite verified sources inline as markdown links.

After the blog post, in the same response, generate:
- META_TITLE (under 60 chars)
- META_DESCRIPTION (under 155 chars)
- X_THREAD (6-10 tweets, hook first)
- LINKEDIN_POST (1500-2200 chars, story-led, no hashtag spam)
- INSTAGRAM_CAPTION (under 2200 chars, hook-driven, 3-5 hashtags)

Format response EXACTLY:

---BLOG_POST---
[full markdown blog post]

---META_TITLE---
[title]

---META_DESCRIPTION---
[description]

---X_THREAD---
[1/ ...]

---LINKEDIN_POST---
[full post]

---INSTAGRAM_CAPTION---
[caption + hashtags]`;

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 } as any],
    messages: [{ role: 'user', content: user }],
  });

  const text = res.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
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
    x_thread: out['x_thread'] ?? '',
    linkedin_post: out['linkedin_post'] ?? '',
    instagram_caption: out['instagram_caption'] ?? '',
  };
}
