/**
 * Is this domain's blog actually indexable?
 *
 * The full-blog embed has two reading modes and only one of them can rank. With
 * a crawlable base configured, cards are real <a href> links to server-rendered
 * article URLs. Without one, articles open in the in-page hash reader — and a
 * fragment (`/blog#grove/my-post`) has never been a separate URL to any crawler
 * (Google dropped `#!` crawling in 2015). A customer in that state has one
 * indexable page no matter how many posts grove publishes, and nothing in the
 * product told them so.
 *
 * This is the single place that answers "where do this domain's articles live,
 * and does search see them" — used by the dashboard to show status and by the
 * embed API to hand `blog_base` to embed.js, so the badge a customer reads and
 * the links their visitors click can't disagree.
 */
import { canonicalBaseFor, servedBlogBaseFor, blogPostUrl, type CanonicalFields } from '@/lib/seo';

export type EmbedSeoState =
  /** Customer renders articles themselves; canonical_blog_base points at them. */
  | 'self-served'
  /** Grove serves the whole blog on the customer's CNAME'd subdomain. */
  | 'subdomain'
  /** The domain IS the app origin (grove's own row) — /b/{slug} is already
   *  on its own domain, so there is nothing to connect. */
  | 'app-origin'
  /** Neither: articles exist only on grove's domain + the hash reader. */
  | 'hash-only';

export type EmbedSeoStatus = {
  state: EmbedSeoState;
  /** Base the embed's cards should link to; null in hash-only mode. */
  articleBase: string | null;
  /** True when a reader (and a crawler) can reach an article at its own URL. */
  crawlable: boolean;
  /** Short status for the dashboard badge. */
  label: string;
  /** One sentence: what search sees today. */
  detail: string;
  /** What to do next — null when nothing needs doing. */
  fix: string | null;
};

/** Built on CanonicalFields rather than restating those two columns, so a
 *  change to the canonical precedence can't leave this helper reading a set of
 *  columns the builders below it no longer agree with. */
type DomainLike = CanonicalFields & {
  hostname?: string | null;
  blog_slug?: string | null;
};

/**
 * `hostedBase` is grove's own origin — used only to describe where the
 * non-canonical mirror lives in the hash-only case, never as an article base.
 * Linking a customer's cards at grove.com would hand grove the search credit
 * for their content, which is the opposite of what they're paying for.
 */
export function embedSeoStatus(
  domain: DomainLike | null | undefined,
  hostedBase = 'https://trygroveai.com',
): EmbedSeoStatus {
  const host = (domain?.hostname ?? 'your site').replace(/^www\./, '');
  const self = domain?.canonical_blog_base ? canonicalBaseFor(domain) : null;
  const served = servedBlogBaseFor(domain);

  if (self) {
    return {
      state: 'self-served',
      articleBase: self,
      crawlable: true,
      label: 'Indexable',
      detail: `Cards link to ${self}/<slug>, and every URL grove emits (canonical, sitemap, RSS, JSON-LD) points there.`,
      fix: null,
    };
  }

  if (served) {
    return {
      state: 'subdomain',
      articleBase: served,
      crawlable: true,
      label: 'Indexable',
      detail: `Cards link to ${served}/<slug> — grove serves those pages with canonical, sitemap, robots, RSS and JSON-LD on your domain.`,
      fix: null,
    };
  }

  const mirror = domain?.blog_slug ? `${hostedBase}/b/${domain.blog_slug}` : hostedBase;

  // Grove's own domain row is a customer like any other, except for one thing:
  // the "grove-hosted mirror" is ON ITS OWN DOMAIN. The hash-only warning below
  // exists because /b/{slug} spends a customer's content on grove's domain —
  // when the domain IS grove's, that sentence ("credit goes to grove") is both
  // false and nonsensical, and the subdomain it tells you to connect would buy
  // nothing. Everything is already where it should be.
  if (domain?.blog_slug && sameHost(domain.hostname, hostedBase)) {
    return {
      state: 'app-origin',
      articleBase: mirror,
      crawlable: true,
      label: 'Indexable',
      detail: `Articles are served at ${mirror}/<slug> — already on this domain, with canonical, sitemap, RSS and JSON-LD.`,
      fix: null,
    };
  }

  return {
    state: 'hash-only',
    articleBase: null,
    crawlable: false,
    label: 'Not indexable',
    detail: `Articles open in the in-page reader at a #fragment, which no crawler treats as its own URL — ${host} has one indexable page.`,
    fix: `Connect a subdomain (step 1) and every article gets a real URL on your domain. Until then the only crawlable copy is grove's mirror at ${mirror}, and that credit goes to grove.`,
  };
}

/** Is this hostname the same site as `base`'s origin? www-insensitive. */
function sameHost(hostname: string | null | undefined, base: string): boolean {
  if (!hostname) return false;
  const strip = (h: string) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return strip(hostname) === strip(base);
}

/**
 * Absolute URL of the crawlable copy of one article — the customer's own base
 * when they have one, else grove's hosted mirror. Never null: the hash reader
 * injects this as rel=canonical, and pointing at the mirror is strictly better
 * than declaring a fragment canonical to itself.
 */
export function crawlableArticleUrl(domain: DomainLike, postSlug: string): string {
  return blogPostUrl(domain.blog_slug ?? '', postSlug, canonicalBaseFor(domain));
}
