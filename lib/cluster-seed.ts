/**
 * Turn a winning post's title (or its generation topic) into the seed phrase a
 * content cluster is built from.
 *
 * The dashboard's "Agent insight" promises a cluster around the top performer;
 * the cluster itself is the programmatic-SEO machine (`lib/pseo.ts`), which
 * expects a short, search-shaped seed — "auto background remover app", not
 * "Finding the Best Auto Background Remover App: 7 Top Picks for 2026". This
 * strips the listicle scaffolding a title carries and leaves the noun phrase
 * the article is actually about, so Google Autocomplete returns siblings of the
 * winner instead of near-duplicates of its headline.
 *
 * Pure + heuristic on purpose: no LLM call stands between clicking the button
 * and seeing what grove is about to write.
 */

/** Scaffolding that only ever leads a headline ("How to…", "The Best…"). */
const LEAD = new Set([
  'a', 'an', 'the', 'my', 'our', 'your',
  'how', 'to', 'why', 'what', 'when', 'where', 'which', 'who',
  'is', 'are', 'do', 'does', 'can', 'should',
  'best', 'top', 'great', 'greatest', 'ultimate', 'complete', 'definitive', 'essential',
  'finding', 'find', 'choosing', 'choose', 'picking', 'pick', 'selecting', 'select',
  'understanding', 'introducing', 'exploring', 'comparing',
  'guide', 'guides', 'intro', 'introduction',
  'in', 'of', 'for', 'on', 'and',
]);

/** Scaffolding that only ever trails one ("… : A Complete Guide for 2026"). */
const TAIL = new Set([
  'guide', 'guides', 'review', 'reviews', 'roundup', 'roundups',
  'picks', 'list', 'lists', 'tips', 'tricks', 'ideas', 'examples',
  'explained', 'compared', 'ranked', 'tested', 'breakdown', 'overview',
  'tutorial', 'walkthrough', 'checklist', 'edition',
  'in', 'of', 'for', 'on', 'and', 'a', 'an', 'the',
]);

const MAX_WORDS = 6;
const MAX_CHARS = 80;   // `/api/pseo/plan` caps the seed at 80

const isYear = (w: string) => /^(19|20)\d{2}$/.test(w);
const isNumber = (w: string) => /^\d+$/.test(w);

/** Split on whitespace/punctuation but keep intra-word hyphens and apostrophes. */
function words(s: string): string[] {
  return s
    .replace(/\([^)]*\)/g, ' ')        // parentheticals are always asides
    .replace(/[^\p{L}\p{N}\-'’]+/gu, ' ')
    .split(' ')
    .map((w) => w.replace(/^[-'’]+|[-'’]+$/g, ''))
    .filter(Boolean);
}

/**
 * The seed phrase for a cluster around `title`, lowercased and trimmed to a
 * handful of words. Returns '' when nothing usable survives (caller decides
 * whether to offer the action at all).
 */
export function clusterSeedFromTitle(title: string): string {
  const raw = (title ?? '').trim();
  if (!raw) return '';

  // A subtitle after ':' / '—' / '|' is nearly always the scaffolding half
  // ("7 Top Picks for 2026"), so keep the head when it carries real words.
  const head = raw.split(/\s*[:|—–]\s*/)[0];
  const base = words(head).length >= 2 ? head : raw;

  let ws = words(base).map((w) => w.toLowerCase()).filter((w) => !isYear(w));

  while (ws.length && (LEAD.has(ws[0]) || isNumber(ws[0]))) ws.shift();
  while (ws.length && (TAIL.has(ws[ws.length - 1]) || isNumber(ws[ws.length - 1]))) ws.pop();

  // Nothing but scaffolding (e.g. "The Ultimate Guide") — fall back to the
  // title's own words so the caller still gets something searchable.
  if (!ws.length) ws = words(base).map((w) => w.toLowerCase()).filter((w) => !isYear(w));

  const seed = ws.slice(0, MAX_WORDS).join(' ').slice(0, MAX_CHARS).trim();
  return seed.length >= 2 ? seed : '';
}
