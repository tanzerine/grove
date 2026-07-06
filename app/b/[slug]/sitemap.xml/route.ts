import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildSitemapXml } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0018 DB
  if (!domain) return new Response('not found', { status: 404 });
  const { data: posts } = await sb
    .from('posts').select('slug,published_at,cover_image_url')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false });

  // With a canonical base set, <loc> entries point at the customer's domain.
  // Google honors cross-host entries when the customer references this sitemap
  // from their own robots.txt (sitemap cross-submission) — documented on the
  // dashboard embed page.
  const xml = buildSitemapXml({
    blogSlug: slug,
    canonicalBase: (domain as any).canonical_blog_base,
    posts: posts ?? [],
  });
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
