/**
 * The article layout grove ships to sites it doesn't control.
 *
 * Two consumers render this: the embed's article endpoint (fetched by
 * embed.js, and by customer pages that render our `html` field server-side),
 * and the MCP server's `get_article` in html format. It used to live inside
 * the embed route, where the second consumer could only have copied it — and a
 * copied layout is how the same post ended up with a boxy inline TOC on one
 * surface and a sidebar on another.
 *
 * Self-contained is not the same as fixed. Every neutral resolves through a
 * `--gv-*` property with its original literal as the fallback: rendered inside
 * the embed, the chrome follows the page embed.js measured; rendered anywhere
 * else, the fallbacks make it byte-identical to what it was. The `theme` colors
 * stay as those fallbacks — they're derived to read on white (accentForText),
 * which is the right assumption for a consumer with no measured page and the
 * wrong one everywhere embed.js has already done better.
 *
 * tests/embed-theme.test.ts reads this file and fails on any color that isn't
 * behind a `--gv-*` property, because a literal here half-applies dark mode on
 * a customer's site and looks fine in review.
 */
import { mdToHtml } from '@/lib/markdown';
import type { TocItem } from '@/lib/markdown';
import type { EmbedTheme } from '@/lib/blog-theme';

export type Toc = TocItem;
export type Cta = { headline: string; subline: string; url: string };

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * A tidy full-width "Table of contents" card at the top of the article body
 * (not a cramped right-float, which reads badly inside a narrow content
 * column), as a single self-contained inline-styled HTML block.
 *
 * --gv-surface, not --gv-raise: only the surface properties are themed by
 * data-theme alone; --gv-raise exists only once embed.js has measured a page.
 */
export function tocHtml(toc: Toc[]): string {
  const items = toc.map((t) =>
    `<li style="margin:${t.level === 3 ? '3px 0 3px 18px' : '5px 0'}">` +
    `<a href="#${esc(t.id)}" style="color:var(--gv-ink,#3a4a3f);text-decoration:none">${esc(t.text)}</a></li>`,
  ).join('');
  return `<div style="margin:10px 0 30px;padding:22px 26px;border:1px solid var(--gv-line,#e6e2d6);border-radius:var(--gv-radius,14px);background:var(--gv-surface,#faf9f5)">` +
    `<div style="font-family:var(--gv-label-font,ui-monospace,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gv-muted,#7a8a7d);margin-bottom:12px">Table of contents</div>` +
    `<ol style="margin:0;padding-left:20px;font-size:15px;line-height:1.6;color:var(--gv-ink,#3a4a3f)">${items}</ol></div>`;
}

/** Polished, self-contained CTA box (dark gradient card + pill button), inline-styled. */
export function ctaHtml(cta: Cta, name: string, theme: EmbedTheme): string {
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
export function buildHtmlField(rawBody: string, toc: Toc[], cta: Cta, name: string, theme: EmbedTheme): string {
  // rawBody already has its leading H1 stripped — the customer's page renders
  // the title from the `title` field.
  const article = mdToHtml(rawBody);
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
    `.grv-toc-t{font-family:var(--gv-label-font,ui-monospace,monospace);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--gv-muted,#7a8a7d);margin-bottom:10px}` +
    `.grv-toc ol{list-style:none;margin:0;padding:0}` +
    `.grv-toc a{display:block;color:var(--gv-muted,#7a8a7d);text-decoration:none;padding:5px 0 5px 14px;border-left:2px solid var(--gv-line,#e6e2d6)}` +
    `.grv-toc a:hover{color:var(--gv-ink,#1a2e1f);border-left-color:var(--gv-accent,${theme.accent})}` +
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
 * them straight through (no internal blank lines that would re-trigger md
 * parsing). This is the `body_md` fallback for consumers that render raw
 * markdown rather than the `html` field above.
 */
export function enrichBody(
  bodyMd: string,
  opts: { toc: Toc[]; cta: Cta; businessName: string; theme: EmbedTheme },
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
