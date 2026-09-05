/**
 * The complete, crawlable link list for one blog.
 *
 * WHY THIS EXISTS. The hosted blog index paginates its card grid at 9 posts,
 * so a blog with 23 articles exposed exactly 10 of them as real `<a href>`
 * links; the other 13 lived only in the page's JSON-LD `blogPost` array, which
 * is metadata, not a link. Everything past the first page sat behind a
 * `?page=N` chain that only ever advertised the NEXT page, so post #20 was
 * three hops from the index — and the index itself is reached from nothing but
 * the sitemap.
 *
 * The measured cost of that shape on grove's own domain: of 24 URLs in the
 * blog sitemap, 14 were "Submitted and indexed" and 9 came back "Discovered –
 * currently not indexed" from the URL Inspection API. Google had every URL —
 * discovery via robots.txt + sitemap works fine — and declined to spend crawl
 * budget on pages nothing linked to. Publishing more articles into that shape
 * makes it worse, not better: more URLs competing for an allocation that is
 * already being withheld.
 *
 * So: every published article gets ONE internal link from its blog's index,
 * for every customer, without pagination in between. A sitemap tells a crawler
 * a URL exists; an internal link is what tells it the URL matters.
 *
 * Kept pure and shared so the hosted blog (`/b/[slug]`) and grove's own
 * dogfooded `/blog` cannot drift into disagreeing about which articles are
 * reachable.
 */
import { blogPostUrl } from './seo';

/**
 * Upper bound on links emitted into one page.
 *
 * Not a correctness limit — a bound on link dilution. At grove's real cadence
 * (~12–40 posts/month per customer) 500 is over a year of output, so in
 * practice every article is covered. Input arrives newest-first, so the cap
 * drops the OLDEST posts, which are the ones most likely to be indexed
 * already; they keep their sitemap entry and their in-body internal links.
 */
export const ARCHIVE_LINK_CAP = 500;

export type ArchivePost = {
  slug: string | null;
  title: string | null;
  published_at?: string | null;
};

export type ArchiveEntry = {
  slug: string;
  /** Anchor text. Falls back to the slug so a title-less row is still a link. */
  title: string;
  /** Absolute URL, canonical-aware — the customer's own base when they own one. */
  url: string;
  publishedAt: string | null;
};

/**
 * Build the archive links for one blog.
 *
 * Input order is PRESERVED rather than re-sorted: callers hand this the same
 * newest-first list the page renders, and a second ordering here would only
 * create a way for the archive and the grid to disagree.
 */
export function archiveEntries(
  posts: ArchivePost[],
  opts: { blogSlug: string; canonicalBase?: string | null; cap?: number },
): ArchiveEntry[] {
  const cap = opts.cap ?? ARCHIVE_LINK_CAP;
  if (cap <= 0) return [];

  const seen = new Set<string>();
  const out: ArchiveEntry[] = [];

  for (const p of posts) {
    const slug = (p.slug ?? '').trim();
    // A post with no slug has no URL to link; a duplicate slug would emit the
    // same href twice, which is dilution rather than coverage.
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const title = (p.title ?? '').trim() || slug;
    out.push({
      slug,
      title,
      url: blogPostUrl(opts.blogSlug, slug, opts.canonicalBase),
      publishedAt: p.published_at ?? null,
    });
    if (out.length >= cap) break;
  }

  return out;
}
