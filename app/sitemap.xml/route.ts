/**
 * The root sitemap — a sitemap INDEX, not a urlset.
 *
 * Before this, `/sitemap.xml` held five marketing URLs and every article lived
 * in a per-blog sitemap announced only by an extra `Sitemap:` line in
 * robots.txt. Discovery worked (Google had the URLs), but the articles were
 * submitted in the weakest way available: no lastmod, no grouping, and no
 * single URL an owner could paste into Search Console to see coverage for the
 * whole property. An index makes every hosted blog a first-class child of one
 * submitted file.
 *
 * Children are same-origin only — see `lib/sitemap-index`. Blogs served from a
 * customer's own domain or a `{slug}.{root}` subdomain are still announced by
 * robots.txt cross-submission, which is the mechanism that actually works for
 * them.
 */
import { appBase, blogHomeUrl } from '@/lib/seo';
import { advertisedBlogs } from '@/lib/advertised-blogs';
import { buildSitemapIndexXml, sitemapIndexChildren } from '@/lib/sitemap-index';

export const dynamic = 'force-dynamic';

export async function GET() {
  const blogs = await advertisedBlogs();

  const children = sitemapIndexChildren({
    appBase: appBase(),
    // No canonical base passed on purpose: this index may only carry sitemaps
    // grove serves from its own origin, and `blogHomeUrl` with a customer's
    // canonical would return their domain — filtered out downstream, but
    // clearer not to ask for it here.
    blogHomeUrls: blogs.map((d) => blogHomeUrl(d.blog_slug)),
  });

  return new Response(buildSitemapIndexXml(children), {
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
