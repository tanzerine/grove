/**
 * Dynamic robots.txt — lists one sitemap per verified domain so crawlers
 * discover every hosted blog without waiting on external links.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogHomeUrl, appBase, canonicalBaseFor } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Blog sitemaps are a best-effort enrichment: if the DB is unreachable or the
  // service-role env is missing, robots.txt must STILL serve (a crashing
  // robots.txt is far worse for crawling than one missing a few blog sitemaps).
  let domains: { blog_slug: string }[] = [];
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
      .filter((d) => !canonicalBaseFor(d as any))
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
