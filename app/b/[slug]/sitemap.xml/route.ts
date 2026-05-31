import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sb = supabaseAdmin();
  const { data: domain } = await sb.from('domains').select('id').eq('blog_slug', slug).single();
  if (!domain) return new Response('not found', { status: 404 });
  const { data: posts } = await sb
    .from('posts').select('slug,published_at')
    .eq('domain_id', domain.id).eq('status', 'published');

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove.so';
  const urls = (posts ?? []).map((p) =>
    `<url><loc>${base}/b/${slug}/${p.slug}</loc><lastmod>${(p.published_at ?? '').slice(0, 10)}</lastmod></url>`
  ).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${base}/b/${slug}</loc></url>${urls}
</urlset>`;
  return new Response(xml, { headers: { 'content-type': 'application/xml' } });
}
