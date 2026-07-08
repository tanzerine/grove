/**
 * Contextual in-body internal links — the part of SEO interlinking the
 * "Keep reading" block can't do.
 *
 * At render time we scan the article body for phrases that match a sibling
 * post's title and turn the first clean occurrence into a markdown link.
 * Render time (not persist time) on purpose: every already-published post
 * benefits immediately, and links keep appearing as the blog grows.
 *
 * Safety rules — we never touch:
 *   - fenced code blocks, headings, blockquotes, table rows
 *   - text inside existing links/images
 *   - posts the body already links to
 * and we add at most `maxLinks` per article, one per target.
 */
import { STOP } from './related-posts';

export type LinkTarget = { slug: string; title: string | null };

const tokenize = (s: string) =>
  s.toLowerCase().split(/[\s,.;:!?()[\]{}"'`~/\\|—–\-·]+/).map((t) => t.trim()).filter(Boolean);

/**
 * Candidate phrases from a title: contiguous runs of non-stopword tokens,
 * expanded into sub-phrases (longest first). "How to Brew Filter Coffee"
 * → ["brew filter coffee", "brew filter", "filter coffee"].
 */
export function keyphrases(title: string | null | undefined): string[] {
  if (!title) return [];
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const t of tokenize(title)) {
    if (STOP.has(t) || /^\d+$/.test(t)) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  if (cur.length) runs.push(cur);

  const phrases = new Set<string>();
  for (const run of runs) {
    for (let len = run.length; len >= 2; len--) {
      for (let i = 0; i + len <= run.length; i++) {
        phrases.add(run.slice(i, i + len).join(' '));
      }
    }
    // single CJK tokens carry a whole word ("보관법") — allow when long enough
    if (run.length === 1 && run[0].length >= 4) phrases.add(run[0]);
  }
  return Array.from(phrases).sort((a, b) => b.length - a.length);
}

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9가-힣぀-ヿ一-鿿]/i.test(c);

/** Find a phrase occurrence at word boundaries, outside protected spans
 *  (existing links/images, inline code). Skips protected occurrences and
 *  keeps searching — a mention inside `code` must not block a clean prose
 *  mention later on the same line. */
function findInSegment(line: string, phrase: string, spans: Array<[number, number]>): number {
  const hay = line.toLowerCase();
  let from = 0;
  while (true) {
    const i = hay.indexOf(phrase, from);
    if (i === -1) return -1;
    const ok = !isWordChar(line[i - 1]) && !isWordChar(line[i + phrase.length]);
    if (ok && !insideAny(i, phrase.length, spans)) return i;
    from = i + 1;
  }
}

// spans we must not link inside: existing links/images ![alt](url) / [text](url)
// and inline code `...` (a phrase in code would render as literal brackets).
const LINK_SPAN = /!?\[[^\]]*\]\([^)]*\)|`[^`\n]*`/g;

function linkSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of line.matchAll(LINK_SPAN)) spans.push([m.index!, m.index! + m[0].length]);
  return spans;
}

const insideAny = (i: number, len: number, spans: Array<[number, number]>) =>
  spans.some(([a, b]) => i < b && i + len > a);

export function injectInternalLinks(
  bodyMd: string,
  targets: LinkTarget[],
  basePath: string,
  maxLinks = 3,
): { body: string; added: Array<{ slug: string; phrase: string }> } {
  const added: Array<{ slug: string; phrase: string }> = [];
  if (!bodyMd || !targets.length) return { body: bodyMd, added };

  const lines = bodyMd.split('\n');
  const candidates = targets
    .filter((t) => t.slug && t.title && !bodyMd.includes(`/${t.slug})`))
    .map((t) => ({ slug: t.slug, phrases: keyphrases(t.title) }))
    .filter((t) => t.phrases.length);

  let inFence = false;
  for (let li = 0; li < lines.length && added.length < maxLinks; li++) {
    const line = lines[li];
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*(#|>|\||!\[)/.test(line)) continue;     // heading / quote / table / image line
    if (!line.trim()) continue;

    const spans = linkSpans(line);
    for (const cand of candidates) {
      if (added.length >= maxLinks) break;
      if (added.some((a) => a.slug === cand.slug)) continue;
      for (const phrase of cand.phrases) {
        const idx = findInSegment(line, phrase, spans);
        if (idx === -1) continue;
        const original = line.slice(idx, idx + phrase.length);
        lines[li] =
          line.slice(0, idx) +
          `[${original}](${basePath}/${cand.slug})` +
          line.slice(idx + phrase.length);
        added.push({ slug: cand.slug, phrase: original });
        break;
      }
      if (added.some((a) => a.slug === cand.slug)) break; // line changed; re-evaluate next line
    }
  }

  return { body: lines.join('\n'), added };
}
