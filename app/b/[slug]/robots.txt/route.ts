/**
 * Per-blog robots.txt — served at {slug}.{root}/robots.txt via the middleware
 * host-rewrite. Each subdomain is its own origin to crawlers, so it needs its
 * own robots file pointing at its own sitemap.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogHomeUrl, servedBlogBaseFor } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0026 DB
  if (!domain) return new Response('not found', { status: 404 });

  // The sitemap pointer must resolve on an origin GROVE serves — the CNAME'd
  // hostname when set (this robots.txt is then served from that origin), else
  // the hosted URL. Never canonical_blog_base: a customer-rendered base has no
  // sitemap.xml, and a robots pointer at a 404 is worse than none.
  const body = `User-agent: *
Allow: /

Sitemap: ${blogHomeUrl(slug, servedBlogBaseFor(domain as any))}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
