import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildRssXml, canonicalBaseFor } from '@/lib/seo';
import { mdToHtml } from '@/lib/markdown';
import { stripLeadingH1 } from '@/lib/article-body';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { languageForDomain } from '@/lib/language';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains').select('*').eq('blog_slug', slug).single(); // '*': survives pre-0018 DB
  if (!domain) return new Response('not found', { status: 404 });

  const { data: posts } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,cover_image_url,body_md,format:research->brief->>format')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(50);

  const lg = languageForDomain(domain);
  const author = authorFor((domain as any).site_profile, domain.hostname, lg.code);
  const items = (posts ?? []).map((p) => ({
    slug: p.slug,
    title: p.title,
    description: p.meta_description,
    publishedAt: p.published_at,
    coverUrl: p.cover_image_url,
    // Readers show the item <title> themselves — the body's own H1 would
    // print the title twice.
    contentHtml: p.body_md ? mdToHtml(stripLeadingH1(p.body_md)) : null,
    category: genreFor((p as any).format, p.title, lg.code).label,
    author,
  }));

  const xml = buildRssXml({
    hostname: domain.hostname,
    blogSlug: slug,
    canonicalBase: canonicalBaseFor(domain),
    inLanguage: lg.tag,
    items,
  });
  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
