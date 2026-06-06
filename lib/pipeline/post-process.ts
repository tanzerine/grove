/**
 * Hard post-processing pass on the writer's markdown output.
 *
 * Prompt instructions are unreliable. Mechanical fixes never miss:
 *   1. Convert [N] numeric references to real markdown citation links
 *   2. Strip banned phrases (replace with neutral wording or remove)
 *   3. Cap em-dashes at 2 per article (extras → commas)
 *   4. Collapse duplicate paragraphs (catches model-loop output)
 *   5. Strip stray "Title:" or "Welcome back to..." preambles from drafts
 *      that ignored the section delimiters
 */
import { BANNED_PHRASES } from './quality-rules';
import type { SearchResult } from '../search';

const REPLACEMENTS: Record<string, string> = {
  elevate: 'lift',
  'game-changer': 'shift',
  'game changer': 'shift',
  unleash: 'release',
  robust: 'solid',
  seamless: 'smooth',
  'cutting-edge': 'current',
  'next-level': 'better',
  transformative: 'meaningful',
  leveraging: 'using',
  delve: 'go',
  'delve into': 'cover',
  tapestry: 'mix',
  myriad: 'many',
  underscore: 'highlight',
};

export function postProcess(rawBody: string, sources: SearchResult[]): string {
  let body = rawBody;

  // ── 0. strip self-introducing preamble that some drafts include ──────
  body = body.replace(/^\s*(?:title:.*?\n)?(?:welcome back to[^\n]*\n)?/i, '');

  // ── 1. convert numeric refs like [1] [2] to markdown links ───────────
  body = body.replace(/\[(\d+)\]/g, (_match, n) => {
    const idx = parseInt(n, 10) - 1;
    const src = sources[idx];
    if (!src) return '';
    return `[(source)](${src.url})`;
  });

  // ── 2. mechanical banned-phrase substitution ─────────────────────────
  for (const phrase of BANNED_PHRASES) {
    const replacement = REPLACEMENTS[phrase.toLowerCase().replace(/[:.]/g, '').trim()] ?? '';
    const re = new RegExp(escapeRegex(phrase), 'gi');
    body = body.replace(re, replacement);
  }
  // tidy double spaces left behind by removals
  body = body.replace(/[ \t]+/g, ' ').replace(/ ,/g, ',').replace(/ \./g, '.');

  // ── 3. cap em-dashes at 2; turn extras into commas ───────────────────
  let dashCount = 0;
  body = body.replace(/—/g, () => (++dashCount <= 2 ? '—' : ','));

  // ── 4. collapse duplicate paragraphs ─────────────────────────────────
  const seen = new Set<string>();
  body = body
    .split(/\n{2,}/)
    .filter((p) => {
      const key = p.trim().slice(0, 80).toLowerCase();
      if (!key) return true;          // blank stays
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n\n');

  // ── 5. final whitespace cleanup ──────────────────────────────────────
  body = body.trim().replace(/\n{3,}/g, '\n\n');

  return body;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the number of inline markdown citation links in the body.
 */
export function citationCount(body: string): number {
  return (body.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g) ?? []).length;
}

/**
 * Marketing safety net — behavior depends on the article's funnel intent.
 *
 *   editorial   → no-op. Pure thought-leadership; we never inject a link.
 *   contextual  → if the body already links to the host, leave it. Otherwise
 *                 find the first plain-prose mention of the brand name and
 *                 wrap it as a markdown link. If neither exists, do nothing —
 *                 a clean article beats a tacked-on link.
 *   conversion  → ensure there's both (a) an inline brand link in the body
 *                 AND (b) a real closing CTA paragraph. Injects whatever is
 *                 missing.
 */
export function ensureHomepageCta(
  body: string,
  opts: {
    businessName: string;
    hostname?: string;
    intent?: 'editorial' | 'contextual' | 'conversion';
  },
): string {
  const { businessName, hostname, intent = 'contextual' } = opts;
  if (intent === 'editorial') return body;
  if (!hostname || !businessName) return body;

  const host = hostname.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = businessName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hostLinked = new RegExp(`https?://(?:www\\.)?${escapedHost}`, 'i').test(body);

  // Inline-link the first plain-prose brand mention.
  const inlineLinkBrand = (text: string): { out: string; linked: boolean } => {
    const re = new RegExp(`(?<![\\[\\w])${escapedName}(?!\\w|\\])`);
    let replaced = false;
    const lines = text.split('\n').map((line) => {
      if (replaced) return line;
      if (/^\s*#/.test(line)) return line;
      if (/^\s*```/.test(line)) return line;
      if (!re.test(line)) return line;
      replaced = true;
      return line.replace(re, `[${businessName}](https://${host})`);
    });
    return { out: lines.join('\n'), linked: replaced };
  };

  if (intent === 'contextual') {
    if (hostLinked) return body;
    const { out } = inlineLinkBrand(body);
    return out;
  }

  // intent === 'conversion' — guarantee both an inline link and a closing CTA.
  let next = body;
  if (!hostLinked) {
    const { out, linked } = inlineLinkBrand(next);
    if (linked) next = out;
  }

  // Detect an existing closing CTA: last 2 paragraphs contain a host link
  // AND a verb that suggests next-step framing.
  const paras = next.trim().split(/\n{2,}/);
  const tail = paras.slice(-2).join('\n\n');
  const hasClosingCta =
    new RegExp(`https?://(?:www\\.)?${escapedHost}`, 'i').test(tail) &&
    /\b(open|generate|sketch|ship|bake|build|launch|design|prototype|explore)\b/i.test(tail);

  if (!hasClosingCta) {
    const cta = `\n\nIf this is the kind of work you're shipping, that's the gap we built [${businessName}](https://${host}) to close — open it the next time you hit this wall.\n`;
    next = next.trimEnd() + cta;
  }

  return next;
}

/**
 * Cap inline citations at MAX. If the writer over-cites, we demote the
 * extras to plain text (link text remains, URL is dropped). This keeps the
 * article reading like a blog post, not a research paper.
 *
 * Strategy: keep the FIRST `max` links — those tend to anchor the strongest
 * claims since writers cite the most important supports early.
 */
export function capCitations(body: string, max = 4): string {
  let count = 0;
  return body.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, text) => {
    count += 1;
    return count <= max ? _match : text;
  });
}
