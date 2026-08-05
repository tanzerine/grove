/**
 * Which blogs belong in the app-level robots.txt.
 *
 * Two filters, for two different reasons:
 *
 *   1. Customer-owned canonical homes are skipped — their sitemap is announced
 *      from that origin's own robots.txt, and advertising the grove-hosted
 *      mirror from here submits URLs that compete with the customer's copy.
 *
 *   2. EMPTY blogs are skipped. The route filtered on verified_at alone, so a
 *      domain row was advertised to Google the moment its DNS record landed —
 *      before a single article existed. In production that meant
 *      trygroveai.com/robots.txt submitted two QA fixtures
 *      (qa2.grove-test.example, example-com-qa) whose sitemaps held exactly one
 *      URL each: an empty blog home, rendering `index, follow`. Every real
 *      customer hit the same thing on their first day. Submitting an empty page
 *      is not neutral — it is the first thing Google learns about the domain.
 *
 * The published-post scan is bounded (robots.txt must never be the query that
 * times out), so it can come back incomplete on a platform large enough to
 * exceed the cap. When it does, `scanComplete: false` makes the unknown
 * domains fail OPEN and stay advertised: one extra empty sitemap costs almost
 * nothing, while dropping a paying customer's sitemap costs them their crawl
 * entry point. Same stance as the route's DB-unavailable path.
 */
import { canonicalBaseFor, type CanonicalFields } from './seo';

export type SitemapCandidate = CanonicalFields & {
  id: string;
  blog_slug: string;
};

export function blogsToAdvertise(input: {
  domains: SitemapCandidate[];
  /** Domain ids observed to have at least one published post. */
  domainsWithPosts: Set<string>;
  /** False when the scan hit its page cap and may have missed a domain. */
  scanComplete: boolean;
}): SitemapCandidate[] {
  const { domains, domainsWithPosts, scanComplete } = input;
  return domains.filter((d) => {
    if (canonicalBaseFor(d)) return false;                 // customer owns the canonical
    if (domainsWithPosts.has(d.id)) return true;           // has something to crawl
    return !scanComplete;                                   // unknown → fail open
  });
}
