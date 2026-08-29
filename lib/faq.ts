/**
 * FAQ extraction — pulls the Q&A pairs out of an article body so they can be
 * (a) counted by the validator and (b) emitted as FAQPage JSON-LD on the public
 * article page.
 *
 * The writer is instructed to end articles with a single `## FAQ` section whose
 * questions are `### ` headings. We require that H2 wrapper on purpose: matching
 * bare `### ` question-shaped headings anywhere would scoop up ordinary
 * subsections and forge structured data Google would (rightly) distrust.
 *
 * Pure + dependency-free so it's safe to import from both lib/ (validator) and
 * app/ (the /b article page) and trivial to unit-test.
 */

import { faqHeadingPattern } from './language';

export type FaqPair = { question: string; answer: string };

/**
 * Which H2 headings open a FAQ section — in EVERY supported language, not just
 * the domain's own. A body is a body: matching only the configured language
 * would leave a Korean article's 자주 묻는 질문 unseen and let the post-processor
 * staple a second, English "## FAQ" underneath it.
 *
 * `\b` is useless against CJK (there is no word boundary between 자주 and 묻는),
 * so the ASCII alternatives keep their boundaries and the rest match as-is.
 */
const FAQ_HEADING = faqHeadingPattern();

/** Strip inline markdown to clean text for schema / counting. */
function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/[*_`>#]/g, '')                  // emphasis / code / quote / heading marks
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract Q&A pairs from the `## FAQ` section of a markdown body.
 * Returns [] when there is no FAQ section. Code fences are skipped so a `##`
 * inside a fenced block can't be mistaken for the FAQ heading.
 */
export function extractFaq(md: string): FaqPair[] {
  if (!md) return [];
  const lines = md.split('\n');

  let inFence = false;
  let inFaq = false;
  const pairs: FaqPair[] = [];
  let curQ: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (curQ) {
      const answer = stripMd(buf.join('\n'));
      const question = stripMd(curQ);
      if (question && answer) pairs.push({ question, answer });
    }
    curQ = null;
    buf = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { if (inFaq) buf.push(line); continue; }

    const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (h2) {
      // Leaving the FAQ section (or entering it).
      flush();
      inFaq = FAQ_HEADING.test(h2[1]);
      continue;
    }

    if (!inFaq) continue;

    const h3 = line.match(/^###\s+(.+?)\s*#*\s*$/);
    if (h3) {
      flush();
      curQ = h3[1];
      continue;
    }

    if (curQ) buf.push(line);
  }
  flush();

  return pairs;
}
