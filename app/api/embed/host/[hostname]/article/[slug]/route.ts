/**
 * Returns one article's full body + SEO meta, keyed by customer hostname
 * and post slug. This is the data the customer's site fetches to render
 * the article under their own URL (so Google credits THEIR domain for SEO).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { extractToc } from '@/lib/markdown';
import { stripLeadingH1, stripLeadingCoverImage } from '@/lib/article-body';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { pickRelated } from '@/lib/related-posts';
import { sanitizeEmbedHost, buildArticleGraph, canonicalBaseFor } from '@/lib/seo';
import { crawlableArticleUrl } from '@/lib/embed-seo';
import { extractFaq } from '@/lib/faq';
import { embedTheme, brandingPayload, resolveBranding } from '@/lib/blog-theme';
import { buildHtmlField, enrichBody } from '@/lib/blog/article-html';
import { resolveBlogDomain } from '@/lib/blog-domain';

export async function GET(_req: Request, ctx: { params: Promise<{ hostname: string; slug: string }> }) {
  const { hostname: raw, slug } = await ctx.params;
  // Strict hostname shape: malformed encoding must not 500, and the value is
  // interpolated into the .or() filter below — commas would inject conditions.
  const host = sanitizeEmbedHost(raw);
  if (!host) {
    return NextResponse.json(
      { error: 'no grove blog for this domain' },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }
  const apex = host.replace(/^www\./, '');

  const sb = supabaseAdmin();
  // A hostname can have more than one domain row (e.g. a stale, empty, unverified
  // duplicate). resolveBlogDomain prefers the row that actually owns published
  // content, so we never look the article up under an empty duplicate and 404 a
  // post that's actually published — this MUST match the list endpoint's
  // resolution or the list and articles disagree.
  const domain = await resolveBlogDomain(sb, apex);

  if (!domain) {
    return NextResponse.json(
      { error: 'no grove blog for this domain' },
      { status: 404, headers: { 'access-control-allow-origin': '*' } }
    );
  }

  const { data: post } = await sb
    .from('posts')
    .select('id,slug,title,body_md,meta_title,meta_description,published_at,updated_at,cover_image_url,cover_image_credit,format:research->brief->>format')
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

  // NOTE: `reads` is NOT incremented here. This endpoint is fetched server-to-
  // server on every SSR/ISR render of the customer's blog page (and by any bot
  // crawling their site), with no way to tell a human from a machine — it used
  // to inflate reads badly. The article payload returns post_id/domain_id so the
  // customer's page fires the client 'view' beacon instead, which is the single
  // honest, per-session-deduped writer of posts.reads (lib/analytics/track.ts).

  // Enrich the payload so the TOC + "Try {business}" CTA show on the customer's
  // own site (which renders what we return here, not Grove's hosted page).
  const business = (domain as any).site_profile?.business ?? null;
  const businessName: string = business?.name || domain.hostname.replace(/^www\./, '');
  const subline: string = business?.value_props?.[0] || business?.description || '';
  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  // Owner-adjustable banner target (domains.cta_url); homepage when unset.
  const ctaUrl: string = (domain as any).cta_url || homeUrl;
  // Palette for the CTA + TOC we return — a manual override wins over the
  // colors crawled from the homepage; Grove greens only when neither is set.
  const branding = resolveBranding(domain);
  const theme = embedTheme(branding);

  // The response carries `title` separately and every consumer renders it in
  // its own chrome, so the body's leading `# Title` is dropped once here —
  // otherwise raw-markdown consumers print the title twice. TOC ids are
  // computed from the same stripped body so anchors match the rendered html.
  // Same for the injected cover: the response carries cover_image_url and
  // embed.js renders it as its own element, so the body copy would dupe it.
  const rawBody = stripLeadingCoverImage(
    stripLeadingH1(post.body_md ?? ''),
    post.cover_image_url,
  );
  const toc = extractToc(rawBody);
  const cta = { headline: `Try ${businessName}`, subline, url: ctaUrl };

  // Siblings for "Keep reading" — returned as structured data so the customer
  // can link to their own article URLs rather than grove's hosted pages.
  const { data: siblings } = await sb
    .from('posts')
    .select('slug,title,meta_description,cover_image_url,published_at')
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .neq('slug', slug)
    .order('published_at', { ascending: false })
    .limit(24);
  const related = pickRelated({ slug, title: post.title }, siblings ?? [], 3);

  // body_md: floated-TOC + CTA injected, so sites rendering raw markdown still
  // show them (fallback). html: a self-contained, responsive 2-column layout
  // (article + sticky right rail + polished CTA) — render THIS field to get the
  // true sidebar with no CSS work on the customer's side.
  const enrichedBody = enrichBody(rawBody, { toc, cta, businessName, theme });
  const html = buildHtmlField(rawBody, toc, cta, businessName, theme);

  // The head signals for the in-page hash reader. A fragment can never be its
  // own indexable URL, so when embed.js opens an article it points rel=canonical
  // at the crawlable copy (the customer's own base when they have one, grove's
  // mirror otherwise) and injects the same Article @graph the hosted page emits.
  // It's the one piece of SEO a script CAN deliver, and it costs one field here.
  const author = authorFor((domain as any).site_profile, domain.hostname);
  const genre = genreFor((post as any).format, post.title);
  const canonicalUrl = crawlableArticleUrl(domain, post.slug);
  const jsonLd = buildArticleGraph({
    hostname: domain.hostname,
    blogSlug: domain.blog_slug ?? '',
    postSlug: post.slug,
    title: post.title ?? '',
    description: post.meta_description,
    image: post.cover_image_url,
    publishedAt: post.published_at,
    updatedAt: (post as any).updated_at,
    businessName,
    homeUrl,
    authorName: author,
    authorIsOrg: author.endsWith('Team'),
    genreLabel: genre.label,
    wordCount: (post.body_md ?? '').split(/\s+/).filter(Boolean).length,
    faqs: extractFaq(post.body_md ?? ''),
    canonicalBase: canonicalBaseFor(domain),
  });

  return NextResponse.json({
    domain: domain.hostname,
    article: {
      post_id: post.id,                  // for first-party analytics beacons
      domain_id: domain.id,              // (pairs with post_id when posting to /api/track)
      slug: post.slug,
      title: post.title,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      genre: genre.label,
      author,
      canonical_url: canonicalUrl,   // rel=canonical for the in-page reader
      json_ld: jsonLd,               // Article @graph — same shape the hosted page emits
      body_md: enrichedBody,             // fallback: floated TOC + CTA inline
      html,                              // RECOMMENDED: full 2-col article + right-rail TOC + CTA
      toc,                               // [{ id, text, level }] — build your own rail if you prefer
      cta,                               // { headline, subline, url } — place the banner yourself
      branding: brandingPayload(branding), // customer palette — theme your own layout with it
      related,                           // [{ slug, title, meta_description, cover_image_url }] — "Keep reading"
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
