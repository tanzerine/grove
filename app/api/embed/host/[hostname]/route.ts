/**
 * Hostname-keyed embed endpoint. Customers don't need to know their slug —
 * the embed script reads window.location.hostname and calls us directly.
 *
 * Handles all common variants (apex, www, with/without protocol) and
 * matches any verified domain row that owns the requested hostname.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogPostUrl } from '@/lib/seo';
import { genreFor, authorFor } from '@/lib/blog-genre';

export async function GET(req: Request, ctx: { params: Promise<{ hostname: string }> }) {
  const { hostname: raw } = await ctx.params;
  const host = decodeURIComponent(raw).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const apex = host.replace(/^www\./, '');
  const url = new URL(req.url);
  // ?limit (1–24, default 12) and ?page for older articles
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, blog_slug, site_profile')
    .or(`hostname.eq.${apex},hostname.eq.www.${apex}`)
    .limit(1)
    .maybeSingle();

  if (!domain) {
    return NextResponse.json(
      { error: 'no grove blog found for this domain', hostname: host },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  const { data: posts, count } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,cover_image_url,cover_image_credit,body_md,format:research->brief->>format', { count: 'exact' })
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const readMinutes = (md: string) => Math.max(1, Math.round((md?.split(/\s+/).length ?? 0) / 225));
  const author = authorFor((domain as any).site_profile, domain.hostname);
  const total = count ?? posts?.length ?? 0;

  return NextResponse.json({
    domain: domain.hostname,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    posts: (posts ?? []).map((p: any) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.meta_description,
      url: blogPostUrl(domain.blog_slug, p.slug),
      date: p.published_at,
      cover_image_url: p.cover_image_url ?? null,
      cover_image_credit: p.cover_image_credit ?? null,
      read_minutes: readMinutes(p.body_md ?? ''),
      genre: genreFor(p.format, p.title).label,
      author,
    })),
  }, { headers: { 'access-control-allow-origin': '*' } });
}
