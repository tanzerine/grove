/**
 * Per-blog robots.txt — served at {slug}.{root}/robots.txt via the middleware
 * host-rewrite. Each subdomain is its own origin to crawlers, so it needs its
 * own robots file pointing at its own sitemap.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogHomeUrl } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id').eq('blog_slug', slug).single();
  if (!domain) return new Response('not found', { status: 404 });

  const body = `User-agent: *
Allow: /

Sitemap: ${blogHomeUrl(slug)}/sitemap.xml
`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
