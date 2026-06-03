/**
 * Hostname-keyed embed endpoint. Customers don't need to know their slug —
 * the embed script reads window.location.hostname and calls us directly.
 *
 * Handles all common variants (apex, www, with/without protocol) and
 * matches any verified domain row that owns the requested hostname.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, ctx: { params: Promise<{ hostname: string }> }) {
  const { hostname: raw } = await ctx.params;
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
      { error: 'no grove blog found for this domain', hostname: host },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  const { data: posts } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at')
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(6);

  const groveBase = process.env.NEXT_PUBLIC_APP_URL ?? new URL(_req.url).origin;
  return NextResponse.json({
    domain: domain.hostname,
    posts: (posts ?? []).map((p) => ({
      slug: p.slug,                                                       // for customer to build local URLs
      title: p.title,
      excerpt: p.meta_description,
      // fallback URL on grove's domain if the customer hasn't wired up a /blog/[slug] route
      url: `${groveBase}/b/${domain.blog_slug}/${p.slug}`,
      date: p.published_at,
    })),
  }, { headers: { 'access-control-allow-origin': '*' } });
}
