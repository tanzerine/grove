/**
 * Key-takeaways / TL;DR extraction.
 *
 * The writer is asked to open each article with a short "Key takeaways" callout
 * (3-5 tight bullets) right after the hook. That block is the single most
 * quotable thing in an article: it's what AI answer engines lift verbatim and
 * what wins list-style featured snippets. This pulls the bullets back out so
 * the validator can confirm they're there.
 *
 * Pure + dependency-free so it's safe to import anywhere and easy to unit-test.
 */

const LABEL = /^\s*(?:#{2,4}\s*|\*\*\s*|__\s*)?(?:key takeaways|takeaways|tl;?dr|the short version|in short)\b/i;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/;

function stripMd(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return the bullet items of the first "Key takeaways"/"TL;DR" block, or [] if
 * there isn't one. A blank line is allowed between the label and the bullets;
 * collection stops at the first non-bullet line once bullets have started.
 * Code fences are skipped.
 */
export function extractTakeaways(md: string): string[] {
  if (!md) return [];
  const lines = md.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!LABEL.test(lines[i])) continue;

    const items: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++; // skip a blank line after the label
    for (; j < lines.length; j++) {
      const m = lines[j].match(BULLET);
      if (m) { items.push(stripMd(m[1])); continue; }
      if (!lines[j].trim() && !items.length) continue; // tolerate stray blanks before bullets
      break;
    }
    if (items.length) return items;
  }
  return [];
}
