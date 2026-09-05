/**
 * Dynamic robots.txt — lists one sitemap per verified domain so crawlers
 * discover every hosted blog without waiting on external links.
 *
 * The root `/sitemap.xml` is now a sitemap INDEX carrying the same-origin
 * blogs (see app/sitemap.xml/route.ts). These per-blog lines are kept anyway,
 * and deliberately: a sitemap index may only reference sitemaps on its own
 * host, so blogs served from a customer domain or a `{slug}.{root}` subdomain
 * can ONLY be announced here. Listing a same-origin blog in both places is
 * harmless — Google de-dupes by URL.
 */
import { appBase, blogHomeUrl } from '@/lib/seo';
import { advertisedBlogs } from '@/lib/advertised-blogs';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Blog sitemaps are a best-effort enrichment: advertisedBlogs() returns []
  // rather than throwing when the DB is unreachable or the service-role env is
  // missing, because a crashing robots.txt is far worse for crawling than one
  // missing a few blog sitemaps.
  const blogs = await advertisedBlogs();

  // With GROVE_BLOG_ROOT_DOMAIN set these point at the subdomains (each of
  // which also serves its own robots.txt); without it, at the /b/ paths.
  // Which blogs qualify — customer-owned canonicals and empty blogs are both
  // skipped — is decided by lib/robots-sitemaps (pure, unit-tested).
  // The root sitemap index goes first: it carries the marketing surface
  // (/pages.xml) plus every blog grove serves from this origin.
  const sitemaps = [
    `Sitemap: ${appBase()}/sitemap.xml`,
    ...blogs.map((d) => `Sitemap: ${blogHomeUrl(d.blog_slug)}/sitemap.xml`),
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
