import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildSitemapXml } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id').eq('blog_slug', slug).single();
  if (!domain) return new Response('not found', { status: 404 });
  const { data: posts } = await sb
    .from('posts').select('slug,published_at,cover_image_url')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false });

  const xml = buildSitemapXml({ blogSlug: slug, posts: posts ?? [] });
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
