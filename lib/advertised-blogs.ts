/**
 * Which hosted blogs grove announces to crawlers, resolved once.
 *
 * Extracted from `app/robots.txt/route.ts` when the root sitemap became a
 * sitemap index and needed the SAME set. Two surfaces computing "which blogs
 * are worth advertising" from two copies of a bounded, fail-open scan is a
 * disagreement waiting to happen: robots.txt would name a blog the sitemap
 * index omitted, or the reverse, and neither would be wrong on its own terms.
 *
 * The selection rules themselves stay in `lib/robots-sitemaps` (pure, tested);
 * this module is only the query that feeds them.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogsToAdvertise, type SitemapCandidate } from '@/lib/robots-sitemaps';

/** Rows per page of the published-post scan, and a cap so neither robots.txt
 *  nor the sitemap index can become the query that times out. ~20k posts is
 *  years of platform output at the current cadence; past it the unknown
 *  domains fail open. */
const POST_PAGE = 1000;
const POST_MAX_PAGES = 20;

/**
 * The set of domain ids with at least one published post.
 *
 * Ordered newest-first and stopped as soon as every candidate is accounted
 * for, so the usual case is a single page: any blog worth advertising has
 * published recently. `complete` is false only when the cap was reached with
 * candidates still unseen — the caller then keeps those rather than dropping a
 * real customer's sitemap on a guess.
 */
async function domainsWithPublishedPosts(
  sb: ReturnType<typeof supabaseAdmin>,
  candidateIds: Set<string>,
): Promise<{ ids: Set<string>; complete: boolean }> {
  const ids = new Set<string>();
  for (let page = 0; page < POST_MAX_PAGES; page++) {
    const from = page * POST_PAGE;
    // No .in() on candidate ids: 500 uuids build a query string long enough to
    // be rejected outright. Ids outside the candidate set are simply ignored.
    const { data, error } = await sb
      .from('posts')
      .select('domain_id')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .range(from, from + POST_PAGE - 1);
    if (error) return { ids, complete: false };
    for (const r of data ?? []) {
      if (candidateIds.has((r as any).domain_id)) ids.add((r as any).domain_id);
    }
    if (ids.size >= candidateIds.size) return { ids, complete: true }; // every candidate covered
    if (!data || data.length < POST_PAGE) return { ids, complete: true }; // read them all
  }
  return { ids, complete: false };
}

/**
 * The blogs to announce. Best-effort by contract: if the DB is unreachable or
 * the service-role env is missing this returns `[]` rather than throwing, so
 * robots.txt and the sitemap index STILL serve. A crashing robots.txt is far
 * worse for crawling than one missing a few blog sitemaps.
 */
export async function advertisedBlogs(): Promise<SitemapCandidate[]> {
  try {
    const sb = supabaseAdmin();
    // '*': survives a pre-0026 DB, and annotating the columns the filter reads
    // would let a narrowed select quietly return rows with no canonical
    // columns at all — advertising mirror sitemaps for customers who own their
    // blog.
    const { data } = await sb
      .from('domains').select('*')
      .not('verified_at', 'is', null)
      .limit(500);
    const domains: SitemapCandidate[] = data ?? [];
    if (!domains.length) return [];
    const withPosts = await domainsWithPublishedPosts(sb, new Set(domains.map((d) => d.id)));
    return blogsToAdvertise({
      domains,
      domainsWithPosts: withPosts.ids,
      scanComplete: withPosts.complete,
    });
  } catch {
    return [];
  }
}
