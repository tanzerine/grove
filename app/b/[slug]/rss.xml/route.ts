import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildRssXml } from '@/lib/seo';
import { mdToHtml } from '@/lib/markdown';
import { genreFor, authorFor } from '@/lib/blog-genre';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('id,hostname,site_profile').eq('blog_slug', slug).single();
  if (!domain) return new Response('not found', { status: 404 });

  const { data: posts } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,cover_image_url,body_md,format:research->brief->>format')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(50);

  const author = authorFor((domain as any).site_profile, domain.hostname);
  const items = (posts ?? []).map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.meta_description,
    publishedAt: p.published_at,
    coverUrl: p.cover_image_url,
    contentHtml: p.body_md ? mdToHtml(p.body_md) : null,
    category: genreFor((p as any).format, p.title).label,
    author,
  }));

  const xml = buildRssXml({ hostname: domain.hostname, blogSlug: slug, items });
  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
