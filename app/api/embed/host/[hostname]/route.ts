/**
 * Hostname-keyed embed endpoint. Customers don't need to know their slug —
 * the embed script reads window.location.hostname and calls us directly.
 *
 * Handles all common variants (apex, www, with/without protocol) and
 * matches any verified domain row that owns the requested hostname.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { blogPostUrl, sanitizeEmbedHost, appBase, canonicalBaseFor } from '@/lib/seo';
import { embedSeoStatus } from '@/lib/embed-seo';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { brandingPayload, resolveBranding } from '@/lib/blog-theme';
import { resolveBlogDomain } from '@/lib/blog-domain';

export async function GET(req: Request, ctx: { params: Promise<{ hostname: string }> }) {
  const { hostname: raw } = await ctx.params;
  // Strict hostname shape: malformed encoding must not 500, and the value is
  // interpolated into the .or() filter below — commas would inject conditions.
  const host = sanitizeEmbedHost(raw);
  if (!host) {
    return NextResponse.json(
      { error: 'no grove blog found for this domain', hostname: String(raw ?? '') },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }
  const apex = host.replace(/^www\./, '');
  const url = new URL(req.url);
  // ?limit (1–24, default 12) and ?page for older articles
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit')) || 12));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const sb = supabaseAdmin();
  // A hostname can have more than one domain row (e.g. a stale, empty, unverified
  // duplicate — often under a different account — alongside the real populated
  // one). resolveBlogDomain prefers the row that actually owns published content
  // so an empty duplicate can never hijack a live blog. This MUST match the
  // article endpoint's resolution or the list and articles disagree.
  const domain = await resolveBlogDomain(sb, apex);

  if (!domain) {
    return NextResponse.json(
      { error: 'no grove blog found for this domain', hostname: host },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  // NOTE: never select body_md here. The list view only needs card metadata,
  // and shipping every article's full body was making the blog embed slow to
  // load (dozens of KB of unused markdown per page). read_minutes was the only
  // consumer, and the embed footer shows the author instead — so it's dropped.
  const { data: posts, count } = await sb
    .from('posts')
    .select('slug,title,meta_description,published_at,cover_image_url,cover_image_credit,format:research->brief->>format', { count: 'exact' })
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    // `slug` is nullable: a post can be briefly 'published' before its slug is
    // assigned, and the 5-min-cached feed would then emit a card that links to
    // `/blog/null` (a 404 for readers, a wasted crawl, and a junk analytics
    // row). Never ship an unlinkable post — the card has nowhere to point.
    .not('slug', 'is', null)
    .neq('slug', '')
    .order('published_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const author = authorFor((domain as any).site_profile, domain.hostname);
  const total = count ?? posts?.length ?? 0;

  return NextResponse.json({
    domain: domain.hostname,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    total,
    // customer palette (manual override wins over crawl) — embed.js themes its
    // cards/chips with `accent` unless the mount div pins data-accent.
    branding: brandingPayload(resolveBranding(domain)),
    // Where this domain's articles are crawlable, or null when nowhere on the
    // customer's own domain. embed.js links its cards here by DEFAULT, so a
    // customer who configures a subdomain gets indexable articles without
    // editing the snippet they pasted months ago — the old behaviour needed
    // data-article-base, an opt-in nobody discovered, and every blog without it
    // read in-page at a #fragment that no crawler can index.
    blog_base: embedSeoStatus(domain as any, appBase()).articleBase,
    posts: (posts ?? []).map((p: any) => ({
      slug: p.slug,
      title: p.title,
      excerpt: p.meta_description,
      // canonicalBaseFor, never the raw column: a customer whose canonical is a
      // CNAME (custom_blog_hostname, canonical_blog_base NULL) would otherwise
      // fall through to the grove mirror and contradict `blog_base` above.
      url: blogPostUrl(domain.blog_slug, p.slug, canonicalBaseFor(domain as any)),
      date: p.published_at,
      cover_image_url: p.cover_image_url ?? null,
      cover_image_credit: p.cover_image_credit ?? null,
      // Kept for back-compat; the embed falls back to a sensible default. Not
      // computed from the body anymore (see the select note above).
      read_minutes: null,
      genre: genreFor(p.format, p.title).label,
      author,
    })),
  }, {
    headers: {
      'access-control-allow-origin': '*',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
