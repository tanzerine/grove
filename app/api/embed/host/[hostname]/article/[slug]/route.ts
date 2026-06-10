/**
 * Returns one article's full body + SEO meta, keyed by customer hostname
 * and post slug. This is the data the customer's site fetches to render
 * the article under their own URL (so Google credits THEIR domain for SEO).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';

export async function GET(_req: Request, ctx: { params: Promise<{ hostname: string; slug: string }> }) {
  const { hostname: raw, slug } = await ctx.params;
  const host = decodeURIComponent(raw).replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
  const apex = host.replace(/^www\./, '');

  const sb = supabaseAdmin();
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, blog_slug, site_profile')
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

  // Enrich the payload so the TOC + "Try {business}" CTA show on the customer's
  // own site (which renders what we return here, not Grove's hosted page).
  const business = (domain as any).site_profile?.business ?? null;
  const businessName: string = business?.name || domain.hostname.replace(/^www\./, '');
  const subline: string = business?.value_props?.[0] || business?.description || '';
  const homeUrl = `https://${domain.hostname.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;

  const rawBody = post.body_md ?? '';
  const toc = extractToc(rawBody);
  const cta = { headline: `Try ${businessName}`, subline, url: homeUrl };

  // Inject TOC (after the hero) + CTA (at the end) into the served body_md so
  // they appear even on sites that just render body_md as-is.
  const enrichedBody = enrichBody(rawBody, { toc, cta, businessName });
  const html = mdToHtml(enrichedBody);   // mdToHtml adds heading ids → TOC anchors work

  return NextResponse.json({
    domain: domain.hostname,
    article: {
      slug: post.slug,
      title: post.title,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      body_md: enrichedBody,
      html,                              // render-ready (article + TOC + CTA), heading ids included
      toc,                               // [{ id, text, level }] — build your own rail if you prefer
      cta,                               // { headline, subline, url } — place the banner yourself
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

type Toc = { id: string; text: string; level: 2 | 3 };

/** Insert a TOC block after the hero (H1 + cover image) and append the CTA banner. */
function enrichBody(
  bodyMd: string,
  opts: { toc: Toc[]; cta: { headline: string; subline: string; url: string }; businessName: string },
): string {
  const { toc, cta } = opts;
  let body = bodyMd;

  if (toc.length >= 2) {
    const tocMd =
      `> **On this page**\n>\n` +
      toc.map((t) => `> ${t.level === 3 ? '    ' : ''}- [${t.text}](#${t.id})`).join('\n');
    const lines = body.split('\n');
    let at = 0;
    const h1 = lines.findIndex((l) => /^#\s/.test(l));
    if (h1 >= 0) {
      at = h1 + 1;
      // skip blank lines and an immediately-following cover image
      while (at < lines.length && (lines[at].trim() === '' || /^!\[.*\]\(.*\)/.test(lines[at].trim()))) at++;
    }
    lines.splice(at, 0, '', tocMd, '');
    body = lines.join('\n');
  }

  const ctaMd =
    `\n\n---\n\n### ${cta.headline}\n\n` +
    (cta.subline ? `${cta.subline}\n\n` : '') +
    `[Visit ${opts.businessName} →](${cta.url})\n`;

  return body + ctaMd;
}
