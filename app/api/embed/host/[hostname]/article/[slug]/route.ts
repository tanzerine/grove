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

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Floated-right TOC rail as a single self-contained, inline-styled HTML block.
 * float:right makes it sit beside the body without needing the host page's CSS;
 * the article text wraps to its left — matching Grove's hosted layout.
 */
function tocHtml(toc: Toc[]): string {
  const items = toc.map((t) =>
    `<li style="padding-left:${t.level === 3 ? 14 : 0}px">` +
    `<a href="#${esc(t.id)}" style="color:#3a4a3f;text-decoration:none;display:block;padding:3px 0">${esc(t.text)}</a></li>`,
  ).join('');
  return `<aside style="float:right;width:240px;max-width:42%;margin:4px 0 22px 30px;padding:18px 20px;` +
    `border:1px solid #e6e2d6;border-radius:14px;background:#faf9f5;font-size:14px;line-height:1.5">` +
    `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a8a7d;margin-bottom:10px">On this page</div>` +
    `<ol style="list-style:none;margin:0;padding:0">${items}</ol></aside>`;
}

/** Polished, self-contained CTA box (dark card + pill button), inline-styled. */
function ctaHtml(cta: { headline: string; subline: string; url: string }, name: string): string {
  return `<div style="clear:both;margin:44px 0 8px;padding:32px 36px;border-radius:16px;background:#1a2e1f;color:#fff;text-align:center">` +
    `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6)">Powered by ${esc(name)}</div>` +
    `<div style="font-size:24px;font-weight:700;margin:8px 0 6px;color:#fff">${esc(cta.headline)}</div>` +
    (cta.subline ? `<p style="color:rgba(255,255,255,.82);font-size:15px;line-height:1.6;margin:0 auto 18px;max-width:46ch">${esc(cta.subline)}</p>` : '') +
    `<a href="${esc(cta.url)}" style="display:inline-block;background:#4e9e6a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:999px;font-weight:600;font-size:15px">Visit ${esc(name)} &rarr;</a></div>`;
}

/**
 * Insert the floated TOC after the hero (H1 + cover) and append the CTA box.
 * Both are single-line inline-styled HTML blocks so markdown renderers pass
 * them straight through (no internal blank lines that would re-trigger md parsing).
 */
function enrichBody(
  bodyMd: string,
  opts: { toc: Toc[]; cta: { headline: string; subline: string; url: string }; businessName: string },
): string {
  const { toc, cta, businessName } = opts;
  let body = bodyMd;

  if (toc.length >= 2) {
    const block = tocHtml(toc);
    const lines = body.split('\n');
    let at = 0;
    const h1 = lines.findIndex((l) => /^#\s/.test(l));
    if (h1 >= 0) {
      at = h1 + 1;
      while (at < lines.length && (lines[at].trim() === '' || /^!\[.*\]\(.*\)/.test(lines[at].trim()))) at++;
    }
    lines.splice(at, 0, '', block, '');
    body = lines.join('\n');
  }

  return `${body}\n\n${ctaHtml(cta, businessName)}\n`;
}
