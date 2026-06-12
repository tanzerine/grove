import { supabaseAdmin } from '@/lib/supabase/admin';
import { escapeXml, blogHomeUrl } from '@/lib/seo';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id,hostname').eq('blog_slug', slug).single();
  if (!domain) return new Response('not found', { status: 404 });

  const { data: posts } = await sb
    .from('posts').select('slug,title,meta_description,published_at,cover_image_url')
    .eq('domain_id', domain.id).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(50);

  const blogUrl = blogHomeUrl(slug);
  const items = (posts ?? []).map((p) => {
    const url = `${blogUrl}/${p.slug}`;
    return `<item>
<title>${escapeXml(p.title ?? '')}</title>
<link>${url}</link>
<guid isPermaLink="true">${url}</guid>
${p.meta_description ? `<description>${escapeXml(p.meta_description)}</description>` : ''}
${p.published_at ? `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : ''}
${p.cover_image_url ? `<enclosure url="${escapeXml(p.cover_image_url)}" type="image/webp" length="0"/>` : ''}
</item>`;
  }).join('\n');

  const lastBuild = posts?.[0]?.published_at
    ? new Date(posts[0].published_at).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${escapeXml(`The ${domain.hostname} blog`)}</title>
<link>${blogUrl}</link>
<atom:link href="${blogUrl}/rss.xml" rel="self" type="application/rss+xml"/>
<description>${escapeXml(`Articles by ${domain.hostname}`)}</description>
<language>en</language>
<lastBuildDate>${lastBuild}</lastBuildDate>
${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
