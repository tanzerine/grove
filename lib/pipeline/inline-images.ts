/**
 * Inline image pipeline — adds 2 illustrative images to a post's body_md,
 * one per major section (H2), chosen by an LLM for visual explainability.
 *
 * Pipeline:
 *  1. Parse body_md → collect all H2 sections + surrounding text as context
 *  2. LLM picks the 2 most visually illustratable sections + writes Flux prompts
 *  3. Generate both images in parallel via Flux Schnell
 *  4. Upload to Supabase Storage (same post-covers bucket)
 *  5. Inject ![heading](url) after each chosen H2 in body_md
 *  6. Persist updated body_md
 *
 * Idempotent: skips if body_md already contains 2+ inline images (beyond cover).
 */
import { llmCall } from '../llm';
import { supabaseAdmin } from '../supabase/admin';
import { generateIllustration } from '../images/illustration';
import { ILLUSTRATION_STYLE as STYLE, imageMarkdown } from '../images/prompt';

const MAX_INLINE = 2;

type Section = { heading: string; lineIndex: number; snippet: string };

function parseSections(bodyMd: string): Section[] {
  const lines = bodyMd.split('\n');
  const sections: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)/);
    if (!m) continue;
    const snippet = lines
      .slice(i + 1, i + 8)
      .filter((l) => l.trim() && !l.startsWith('#'))
      .join(' ')
      .slice(0, 220);
    sections.push({ heading: m[1].trim(), lineIndex: i, snippet });
  }
  return sections;
}

function countInlineImages(bodyMd: string): number {
  // Count ![...](...) occurrences that appear after H2 lines (not the cover after H1)
  const lines = bodyMd.split('\n');
  let count = 0;
  let pastFirstH2 = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) pastFirstH2 = true;
    if (pastFirstH2 && /^!\[.+\]\(.+\)/.test(line.trim())) count++;
  }
  return count;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pickSections(
  sections: Section[],
  title: string,
): Promise<{ heading: string; prompt: string }[]> {
  const count = Math.min(MAX_INLINE, sections.length);
  const list = sections
    .map((s, i) => `${i + 1}. "${s.heading}"\n   Context: ${s.snippet || '(no text preview)'}`)
    .join('\n\n');

  const { text } = await llmCall({
    fast: true,
    maxTokens: 500,
    system: `You select which article sections most benefit from a visual illustration and write image prompts for them.
Pick exactly ${count} section(s). Choose sections that describe a process, comparison, concept, or tool — something a diagram or scene can convey.
For each, write ONE concrete Flux Schnell image prompt: specific objects, materials, lighting. No text in image. No people. ${STYLE}.

Output ONLY valid JSON, no markdown fences:
[{"heading": "exact heading text", "prompt": "flux prompt here"}]`,
    user: `Article title: "${title}"\n\nSections:\n${list}`,
  });

  try {
    const raw = text.trim().replace(/^```(?:json)?\n?|```$/gm, '').trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_INLINE) : [];
  } catch {
    return [];
  }
}

function injectInlineImages(
  bodyMd: string,
  insertions: { heading: string; url: string }[],
): string {
  const lines = bodyMd.split('\n');

  // Find line indexes for each heading, then sort descending so splices don't shift later indexes
  const located = insertions
    .map(({ heading, url }) => {
      const idx = lines.findIndex((l) =>
        new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`).test(l)
      );
      return idx === -1 ? null : { idx, url, heading };
    })
    .filter((x): x is { idx: number; url: string; heading: string } => x !== null)
    .sort((a, b) => b.idx - a.idx);

  for (const { idx, url, heading } of located) {
    lines.splice(idx + 1, 0, '', imageMarkdown(heading, url), '');
  }

  return lines.join('\n');
}

export async function runInlineImagesForPost(postId: string): Promise<void> {
  const sb = supabaseAdmin();
  const { appendLog } = await import('./log');

  const { data: post } = await sb
    .from('posts')
    .select('title, meta_title, body_md')
    .eq('id', postId)
    .single();

  if (!post?.body_md) return;

  const bodyMd: string = (post as any).body_md;
  const title: string = (post as any).meta_title || (post as any).title || '';

  // Skip if already has inline images (idempotency guard)
  if (countInlineImages(bodyMd) >= MAX_INLINE) {
    await appendLog(postId, 'inline_images', 'done', 'already present, skipped');
    return;
  }

  const sections = parseSections(bodyMd);
  if (sections.length === 0) {
    await appendLog(postId, 'inline_images', 'done', 'no H2 sections');
    return;
  }

  await appendLog(postId, 'inline_images', 'start', `${sections.length} H2 sections`);

  let chosen: { heading: string; prompt: string }[];
  try {
    chosen = await pickSections(sections, title);
  } catch (err: any) {
    await appendLog(postId, 'inline_images', 'fail', `LLM pick failed: ${err?.message}`);
    return;
  }

  if (chosen.length === 0) {
    await appendLog(postId, 'inline_images', 'done', 'LLM selected no sections');
    return;
  }

  // Generate all images in parallel
  const results = await Promise.all(
    chosen.map(async ({ heading, prompt }) => {
      const url = await generateIllustration(prompt, { prefix: 'inline' });
      return url ? { heading, url } : null;
    })
  );

  const insertions = results.filter(
    (r): r is { heading: string; url: string } => r !== null
  );

  if (insertions.length === 0) {
    await appendLog(postId, 'inline_images', 'fail', 'all Flux generations failed');
    return;
  }

  // Re-fetch body_md — cover image step may have updated it since we read it
  const { data: fresh } = await sb.from('posts').select('body_md').eq('id', postId).single();
  const currentBody: string = (fresh as any)?.body_md ?? bodyMd;

  const updatedBody = injectInlineImages(currentBody, insertions);
  await sb.from('posts').update({ body_md: updatedBody }).eq('id', postId);

  await appendLog(postId, 'inline_images', 'done', `${insertions.length} images injected`);
}
