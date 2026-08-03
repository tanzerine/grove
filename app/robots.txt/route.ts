/**
 * Dynamic robots.txt — lists one sitemap per verified domain so crawlers
 * discover every hosted blog without waiting on external links.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogHomeUrl, appBase, canonicalBaseFor, type CanonicalFields } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Blog sitemaps are a best-effort enrichment: if the DB is unreachable or the
  // service-role env is missing, robots.txt must STILL serve (a crashing
  // robots.txt is far worse for crawling than one missing a few blog sitemaps).
  // Annotated with the columns the filter below actually reads. It declared
  // only blog_slug before, so the canonical check had to be cast through `any`
  // — which would have kept type-checking if the select ever stopped being '*'
  // and started returning rows with no canonical columns at all, quietly
  // advertising mirror sitemaps for customers who own their blog.
  let domains: (CanonicalFields & { blog_slug: string })[] = [];
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('domains').select('*') // '*': survives pre-0026 DB
      .not('verified_at', 'is', null)
      .limit(500);
    domains = data ?? [];
  } catch {
    /* DB/env unavailable — fall through with just the marketing sitemap */
  }

  // With GROVE_BLOG_ROOT_DOMAIN set these point at the subdomains (each of
  // which also serves its own robots.txt); without it, at the /b/ paths.
  // Blogs whose canonical home is customer-owned (self-served base or CNAME'd
  // hostname) are skipped: their sitemap is announced from that origin's own
  // robots.txt, and advertising the mirror from here would submit URLs that
  // compete with the customer's copy.
  // The marketing sitemap (app/sitemap.ts) goes first so the homepage + legal
  // pages have a crawl entry point — they were in no sitemap before.
  const sitemaps = [
    `Sitemap: ${appBase()}/sitemap.xml`,
    ...domains
      .filter((d) => !canonicalBaseFor(d))
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
