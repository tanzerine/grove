/**
 * Returns one article's full body + SEO meta, keyed by customer hostname
 * and post slug. This is the data the customer's site fetches to render
 * the article under their own URL (so Google credits THEIR domain for SEO).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, ctx: { params: Promise<{ hostname: string; slug: string }> }) {
  const { hostname: raw, slug } = await ctx.params;
  const host = decodeURIComponent(raw).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const apex = host.replace(/^www\./, '');

  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, blog_slug')
    .or(`hostname.eq.${apex},hostname.eq.www.${apex}`)
    .limit(1)
    .maybeSingle();

  if (!domain) {
    return NextResponse.json(
      { error: 'no grove blog for this domain' },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  const { data: post } = await sb
    .from('posts')
    .select('slug,title,body_md,meta_title,meta_description,published_at,reads,cover_image_url,cover_image_credit')
    .eq('domain_id', domain.id)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (!post) {
    return NextResponse.json(
      { error: 'article not found or not published' },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  // best-effort read tracking; never block the response on it
  sb.from('posts').update({ reads: (post.reads ?? 0) + 1 }).eq('slug', slug).eq('domain_id', domain.id)
    .then(() => {}, () => {});

  return NextResponse.json({
    domain: domain.hostname,
    article: {
      slug: post.slug,
      title: post.title,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      body_md: post.body_md,
      published_at: post.published_at,
      cover_image_url: post.cover_image_url ?? null,
      cover_image_credit: post.cover_image_credit ?? null,
    },
  }, {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=600',
    },
  });
}
