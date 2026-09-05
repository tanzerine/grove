/**
 * Who the customer IS, as an entity — the `sameAs` half of Organization JSON-LD.
 *
 * grove emitted `Organization { name, url }` on every article and blog home and
 * nothing else. Schema-wise that names an entity without connecting it to
 * anything, so a search or answer engine has no way to tell that the
 * Organization on blog.acme.com is the same Organization behind acme's LinkedIn
 * page. `sameAs` is the documented way to say so, and it was absent from the
 * codebase entirely — grep found zero occurrences before this file.
 *
 * The hard part is not emitting the field. It is deciding what belongs in it.
 * A naive "collect every href pointing at a social host" produces garbage:
 * grove's own pages link `twitter.com/intent/tweet?...` and
 * `linkedin.com/sharing/share-offsite/?url=...` on every article (the share
 * buttons), and grove's ARTICLES cite `youtube.com/watch?v=…`,
 * `linkedin.com/posts/…` and `facebook.com/groups/…/posts/…` as sources. An
 * SEO crawl of blog.oveners.com read exactly that mixture back as the site's
 * "social profiles" — 100+ share-intent URLs and third-party citations, not one
 * real profile. Claiming those as `sameAs` would assert that the customer IS
 * every person they ever linked to, which is worse than emitting nothing.
 *
 * So this module is deliberately strict in two ways:
 *   1. It only ever reads the customer's OWN HOMEPAGE, where an outbound social
 *      link is nearly always the brand's own account, never a citation.
 *   2. Every candidate must match a known profile SHAPE for its host, and every
 *      known share/permalink shape is rejected outright.
 * When in doubt it returns nothing. An empty `sameAs` is omitted from the graph,
 * which is exactly the state grove was already in — the failure mode is "no
 * improvement", never "a false identity claim".
 */

/** Where a profile can live, and what a profile URL looks like there. */
type HostRule = {
  /** Path prefixes that are never a profile — shares, permalinks, embeds. */
  deny?: RegExp;
  /** A profile path must match this. Anchored against the pathname. */
  allow: RegExp;
};

/**
 * Keyed by hostname with any leading `www.` and `m.` already stripped.
 * Kept small on purpose: a host nobody can verify the shape of is a host that
 * should not contribute an identity claim.
 */
const HOSTS: Record<string, HostRule> = {
  // /intent/*, /share, /home are compose screens, not accounts. The boundary is
  // `(?:\/|$)`, not `\/` — a bare `/share` has no trailing slash and would
  // otherwise match the handle rule below and be claimed as an account.
  'twitter.com': { deny: /^\/(intent|share|home|hashtag|i)(?:\/|$)/, allow: /^\/[A-Za-z0-9_]{1,15}\/?$/ },
  'x.com': { deny: /^\/(intent|share|home|hashtag|i)(?:\/|$)/, allow: /^\/[A-Za-z0-9_]{1,15}\/?$/ },
  // /sharing/* is the share widget; /posts/ and /pulse/ are individual articles
  // (grove's own writer cites these constantly).
  'linkedin.com': {
    deny: /^\/(sharing|shareArticle|posts|pulse|feed|jobs)\b/,
    allow: /^\/(company|in|school|showcase)\/[^/]+\/?$/,
  },
  // /watch, /playlist, /results are content; only channel forms are identities.
  'youtube.com': {
    deny: /^\/(watch|playlist|results|shorts|embed)\b/,
    allow: /^\/(@[^/]+|c\/[^/]+|channel\/[^/]+|user\/[^/]+)\/?$/,
  },
  // /groups/…/posts/… and /sharer/ are the two that polluted the real crawl.
  'facebook.com': {
    deny: /^\/(sharer|share|groups|events|photo|permalink|story\.php)\b/,
    allow: /^\/[A-Za-z0-9.\-]{3,}\/?$/,
  },
  'instagram.com': { deny: /^\/(p|reel|reels|explore|stories)\b/, allow: /^\/[A-Za-z0-9._]{1,30}\/?$/ },
  'github.com': { deny: /^\/(search|topics|orgs|sponsors)\b/, allow: /^\/[A-Za-z0-9-]{1,39}\/?$/ },
  'tiktok.com': { deny: /^\/(video|tag|search)\b/, allow: /^\/@[A-Za-z0-9._]{1,24}\/?$/ },
  'threads.net': { deny: /^\/(post|t)\b/, allow: /^\/@[A-Za-z0-9._]{1,30}\/?$/ },
  'crunchbase.com': { allow: /^\/organization\/[^/]+\/?$/ },
  'producthunt.com': { deny: /^\/(posts|discussions)\b/, allow: /^\/@[^/]+\/?$/ },
};

/** Enough for any real brand's footer; a cap so one page can't flood the graph. */
const MAX_PROFILES = 12;
const MAX_URL_LENGTH = 200;

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
}

/**
 * Normalize one href into a canonical social-profile URL, or null when it is
 * not a profile. Null is the common and correct answer — most links on a
 * homepage are not identities.
 *
 * `base` resolves relative hrefs; a relative href can never be a social profile,
 * but resolving first is what lets the host check reject it cleanly.
 */
export function socialProfileUrl(href: string, base?: string): string | null {
  const raw = (href ?? '').trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return null;

  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = bareHost(u.hostname);
  const rule = HOSTS[host];
  if (!rule) return null;

  // Decode once so a percent-encoded share path can't sneak past `deny`.
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep the raw pathname when it isn't valid UTF-8 */
  }
  if (rule.deny?.test(path)) return null;
  if (!rule.allow.test(path)) return null;

  // A query string on a profile URL is tracking, not identity (?ref=, ?utm_*).
  // Dropping it is also what makes two spellings of one account dedupe.
  const clean = path.replace(/\/$/, '');
  return `https://${host}${clean}`;
}

/**
 * Every social profile linked from one page of HTML.
 *
 * Only ever call this with the customer's own homepage. Run against an article
 * body it would happily return the profiles of everyone the writer cited.
 */
export function extractSocialProfiles(html: string, base?: string): string[] {
  const found = new Set<string>();
  // Attribute-order-tolerant: `<a class="x" href="…">` is as common as `<a href=…>`.
  for (const m of String(html ?? '').matchAll(/<a\b[^>]*?href=["']([^"']+)["']/gi)) {
    const url = socialProfileUrl(m[1], base);
    if (url) found.add(url);
    if (found.size >= MAX_PROFILES) break;
  }
  // Sorted so the emitted graph is stable across crawls — an unstable `sameAs`
  // makes every re-render look like a content change to a differ.
  return Array.from(found).sort();
}

/**
 * The `sameAs` array for a domain's Organization node.
 *
 * Re-validates on the way out rather than trusting the stored profile: rows
 * written before this feature existed hold no `profiles` at all, and a row is
 * editable state. Same belt-and-braces reasoning as the testimonial consent
 * check — validate on the way in AND on the way out.
 */
export function sameAsFor(siteProfile: unknown): string[] {
  const raw = (siteProfile as { business?: { profiles?: unknown } } | null)?.business?.profiles;
  if (!Array.isArray(raw)) return [];
  const out = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const url = socialProfileUrl(entry);
    if (url) out.add(url);
    if (out.size >= MAX_PROFILES) break;
  }
  return Array.from(out).sort();
}
