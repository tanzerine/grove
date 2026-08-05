/**
 * Dynamic robots.txt — lists one sitemap per verified domain so crawlers
 * discover every hosted blog without waiting on external links.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogHomeUrl, appBase } from '@/lib/seo';
import { blogsToAdvertise, type SitemapCandidate } from '@/lib/robots-sitemaps';

export const dynamic = 'force-dynamic';

/** Rows per page of the published-post scan, and a cap so robots.txt can never
 *  become the query that times out. ~20k posts is years of platform output at
 *  the current cadence; past it the unknown domains fail open. */
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

export async function GET() {
  // Blog sitemaps are a best-effort enrichment: if the DB is unreachable or the
  // service-role env is missing, robots.txt must STILL serve (a crashing
  // robots.txt is far worse for crawling than one missing a few blog sitemaps).
  // Annotated with the columns the filter below actually reads. It declared
  // only blog_slug before, so the canonical check had to be cast through `any`
  // — which would have kept type-checking if the select ever stopped being '*'
  // and started returning rows with no canonical columns at all, quietly
  // advertising mirror sitemaps for customers who own their blog.
  let domains: SitemapCandidate[] = [];
  let withPosts = { ids: new Set<string>(), complete: false };
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('domains').select('*') // '*': survives pre-0026 DB
      .not('verified_at', 'is', null)
      .limit(500);
    domains = data ?? [];
    if (domains.length) {
      withPosts = await domainsWithPublishedPosts(sb, new Set(domains.map((d) => d.id)));
    }
  } catch {
    /* DB/env unavailable — fall through with just the marketing sitemap */
  }

  // With GROVE_BLOG_ROOT_DOMAIN set these point at the subdomains (each of
  // which also serves its own robots.txt); without it, at the /b/ paths.
  // Which blogs qualify — customer-owned canonicals and empty blogs are both
  // skipped — is decided by lib/robots-sitemaps (pure, unit-tested).
  // The marketing sitemap (app/sitemap.ts) goes first so the homepage + legal
  // pages have a crawl entry point — they were in no sitemap before.
  const sitemaps = [
    `Sitemap: ${appBase()}/sitemap.xml`,
    ...blogsToAdvertise({ domains, domainsWithPosts: withPosts.ids, scanComplete: withPosts.complete })
      .map((d) => `Sitemap: ${blogHomeUrl(d.blog_slug)}/sitemap.xml`),
  ].join('\n');

  const body = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /api/
Disallow: /onboarding
Disallow: /login
Disallow: /signup
Disallow: /auth/

${sitemaps}
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
