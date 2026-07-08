/**
 * Returns one article's full body + SEO meta, keyed by customer hostname
 * and post slug. This is the data the customer's site fetches to render
 * the article under their own URL (so Google credits THEIR domain for SEO).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { mdToHtml, extractToc } from '@/lib/markdown';
import { genreFor, authorFor } from '@/lib/blog-genre';
import { pickRelated } from '@/lib/related-posts';
import { sanitizeEmbedHost } from '@/lib/seo';
import { embedTheme, brandingPayload, type EmbedTheme } from '@/lib/blog-theme';

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
  // A hostname can have more than one domain row (e.g. a stale unverified
  // duplicate). Prefer the verified row so we don't look the article up under
  // an empty duplicate and 404 a post that's actually published — this must
  // match the list endpoint's ordering or the list and articles disagree.
  const { data: domain } = await sb
    .from('domains')
    .select('*') // '*': survives a DB where cta_url (0021) hasn't been applied yet
    .or(`hostname.eq.${apex},hostname.eq.www.${apex}`)
    .order('verified_at', { ascending: false, nullsFirst: false })
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
    .select('id,slug,title,body_md,meta_title,meta_description,published_at,cover_image_url,cover_image_credit,format:research->brief->>format')
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
  // Palette extracted from the customer's homepage — the CTA + TOC we return
  // must match THEIR site, not Grove's greens (those are only the fallback).
  const branding = (domain as any).site_profile?.branding ?? null;
  const theme = embedTheme(branding);

  const rawBody = post.body_md ?? '';
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

  return NextResponse.json({
    domain: domain.hostname,
    article: {
      post_id: post.id,                  // for first-party analytics beacons
      domain_id: domain.id,              // (pairs with post_id when posting to /api/track)
      slug: post.slug,
      title: post.title,
      meta_title: post.meta_title,
      meta_description: post.meta_description,
      genre: genreFor((post as any).format, post.title).label,
      author: authorFor((domain as any).site_profile, domain.hostname),
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
    `<li style="margin:${t.level === 3 ? '3px 0 3px 18px' : '5px 0'}">` +
    `<a href="#${esc(t.id)}" style="color:#3a4a3f;text-decoration:none">${esc(t.text)}</a></li>`,
  ).join('');
  // A tidy full-width "Table of contents" card at the top of the article body
  // (not a cramped right-float, which reads badly inside a narrow content column).
  return `<div style="margin:10px 0 30px;padding:22px 26px;border:1px solid #e6e2d6;border-radius:14px;background:#faf9f5">` +
    `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a8a7d;margin-bottom:12px">Table of contents</div>` +
    `<ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:#3a4a3f">${items}</ol></div>`;
}

type Cta = { headline: string; subline: string; url: string };

/** Polished, self-contained CTA box (dark gradient card + pill button), inline-styled. */
function ctaHtml(cta: Cta, name: string, theme: EmbedTheme): string {
  return `<div style="clear:both;margin:48px 0 8px;padding:40px 36px;border-radius:18px;background:linear-gradient(135deg,${theme.bannerFrom},${theme.bannerTo});color:${theme.bannerText};text-align:center;box-shadow:0 12px 40px rgba(20,20,20,.18)">` +
    `<div style="font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${theme.bannerMuted}">Powered by ${esc(name)}</div>` +
    `<div style="font-size:27px;font-weight:700;line-height:1.2;margin:10px 0 8px;color:${theme.bannerText}">${esc(cta.headline)}</div>` +
    (cta.subline ? `<p style="color:${theme.bannerMuted};font-size:15.5px;line-height:1.6;margin:0 auto 22px;max-width:48ch">${esc(cta.subline)}</p>` : '') +
    `<a href="${esc(cta.url)}" data-conv style="display:inline-block;background:${theme.btn};color:${theme.btnText};text-decoration:none;padding:14px 30px;border-radius:999px;font-weight:700;font-size:15px;box-shadow:0 6px 18px rgba(20,20,20,.25)">Visit ${esc(name)} &rarr;</a></div>`;
}

/**
 * The recommended `html` field: a self-contained, responsive two-column article
 * — body left, sticky TOC rail right, polished CTA below — with a scoped
 * <style> block so it needs ZERO CSS on the customer's page. They just render
 * this string. Collapses to one column under 820px.
 */
function stripLeadingH1(md: string): string {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && /^#\s+/.test(lines[i].trim())) lines.splice(i, 1);
  return lines.join('\n');
}

function buildHtmlField(rawBody: string, toc: Toc[], cta: Cta, name: string, theme: EmbedTheme): string {
  // Drop the article's own H1 — the customer's page already renders the title,
  // so keeping it here would print the title twice.
  const article = mdToHtml(stripLeadingH1(rawBody));
  const hasToc = toc.length >= 2;
  const tocAside = hasToc
    ? `<aside class="grv-toc"><div class="grv-toc-t">On this page</div><ol>` +
      toc.map((t) => `<li class="${t.level === 3 ? 'grv-l3' : ''}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join('') +
      `</ol></aside>`
    : '';
  const style =
    `<style>` +
    `.grv-root{box-sizing:border-box}` +
    `.grv-wrap{display:grid;grid-template-columns:minmax(0,1fr)${hasToc ? ' 240px' : ''};gap:44px;align-items:start}` +
    `.grv-toc{position:sticky;top:24px;font-size:14px;line-height:1.5}` +
    `.grv-toc-t{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a8a7d;margin-bottom:10px}` +
    `.grv-toc ol{list-style:none;margin:0;padding:0}` +
    `.grv-toc a{display:block;color:#7a8a7d;text-decoration:none;padding:5px 0 5px 14px;border-left:2px solid #e6e2d6}` +
    `.grv-toc a:hover{color:#1a2e1f;border-left-color:${theme.accent}}` +
    `.grv-toc li.grv-l3 a{padding-left:26px;font-size:13px}` +
    `.grv-cta{margin:48px 0 8px;padding:40px 36px;border-radius:18px;background:linear-gradient(135deg,${theme.bannerFrom},${theme.bannerTo});color:${theme.bannerText};text-align:center;box-shadow:0 12px 40px rgba(20,20,20,.18)}` +
    `.grv-cta .k{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${theme.bannerMuted}}` +
    `.grv-cta h3{font-size:27px;font-weight:700;line-height:1.2;margin:10px 0 8px;color:${theme.bannerText}}` +
    `.grv-cta p{color:${theme.bannerMuted};font-size:15.5px;line-height:1.6;margin:0 auto 22px;max-width:48ch}` +
    `.grv-cta a{display:inline-block;background:${theme.btn};color:${theme.btnText};text-decoration:none;padding:14px 30px;border-radius:999px;font-weight:700;font-size:15px}` +
    `@media(max-width:820px){.grv-wrap{grid-template-columns:1fr}.grv-toc{display:none}}` +
    `</style>`;
  const ctaBox =
    `<div class="grv-cta"><div class="k">Powered by ${esc(name)}</div><h3>${esc(cta.headline)}</h3>` +
    (cta.subline ? `<p>${esc(cta.subline)}</p>` : '') +
    `<a href="${esc(cta.url)}" data-conv>Visit ${esc(name)} &rarr;</a></div>`;
  return `<div class="grv-root">${style}<div class="grv-wrap"><div class="grv-body">${article}</div>${tocAside}</div>${ctaBox}</div>`;
}

/**
 * Insert the floated TOC after the hero (H1 + cover) and append the CTA box.
 * Both are single-line inline-styled HTML blocks so markdown renderers pass
 * them straight through (no internal blank lines that would re-trigger md parsing).
 */
function enrichBody(
  bodyMd: string,
  opts: { toc: Toc[]; cta: { headline: string; subline: string; url: string }; businessName: string; theme: EmbedTheme },
): string {
  const { toc, cta, businessName, theme } = opts;
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

  return `${body}\n\n${ctaHtml(cta, businessName, theme)}\n`;
}
