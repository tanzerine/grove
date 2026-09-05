/**
 * Grove's own top navigation — ONE definition of it.
 *
 * There were three. The landing built its bar inline (components/Landing.tsx),
 * /blog hand-copied it with a comment claiming it was "same shape as the
 * landing's", and the hosted blog reconstructs one from the homepage capture.
 * The copy drifted the moment the landing gained an item: /blog shipped
 * Agents · Platform · Pricing · Blog and no FAQ, so a reader who followed the
 * landing's own Blog link arrived at a nav one item shorter than the one they
 * had just used.
 *
 * A hand-copied nav will drift again, so the links live here and the pages
 * render them. `tests/site-nav.test.ts` fails if a page reintroduces its own.
 *
 * The hosted blog is deliberately NOT a consumer: it serves customers, whose
 * nav comes from their own site (lib/site-design). What keeps it honest for
 * grove's own blog is the capture matching this list — which the same test
 * asserts against the fixture.
 */
import type { CSSProperties } from 'react';
import { createT, type UiLocale } from '@/lib/i18n';
import LangSwitch from '@/components/LangSwitch';

export type SiteNavLink = { label: string; hash?: string; href?: string };

/**
 * The bar, top to bottom. Add an item here and every grove page gains it.
 *
 * The `label` is BOTH the English text and the identity of the item — the
 * catalogue key, and what `active` is matched against. It stays English for
 * that reason; `locale` decides what is rendered.
 */
export const SITE_NAV_LINKS: readonly SiteNavLink[] = [
  { label: 'Agents', hash: '#agents' },
  { label: 'Platform', hash: '#platform' },
  { label: 'Pricing', hash: '#pricing' },
  { label: 'Blog', href: '/blog' },
  { label: 'FAQ', hash: '#faq' },
];

/** Resolve one item's destination for the page it is being rendered on. */
export function siteNavHref(link: SiteNavLink, onLanding: boolean): string {
  if (link.href) return link.href;
  return onLanding ? link.hash! : `/${link.hash}`;
}

const CSS = `
.gv-snav { position: sticky; top: 0; z-index: 50; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); background-color: #000000C7; border-bottom: 1px solid rgba(255,255,255,0.08); font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif; }
.gv-snav-fixed { position: fixed; top: 0; left: 0; right: 0; border-bottom: none; }
.gv-snav-in { max-width: 1200px; margin: 0 auto; width: 100%; box-sizing: border-box; display: flex; align-items: center; gap: 28px; padding: 16px 24px; }
.gv-snav-brand { display: flex; align-items: center; gap: 5px; text-decoration: none; color: #f4f4f2; font-weight: 500; font-size: 14px; letter-spacing: -0.02em; }
.gv-snav-mark { width: 28px; height: 28px; border-radius: 6px; object-fit: contain; display: block; background-color: #000; }
.gv-snav-links { display: flex; gap: 26px; flex: 1; font-size: 14px; font-weight: 500; }
.gv-snav-link { color: #9a9d97; text-decoration: none; transition: color .2s; white-space: nowrap; }
.gv-snav-link:hover, .gv-snav-link[aria-current='page'] { color: #f4f4f2; }
.gv-snav-cta { margin-left: auto; height: 32px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; padding: 0 18px; border-radius: 8px; background: #f4f4f2; color: #0a0a0a; font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; transition: transform .18s, opacity .18s; }
.gv-snav-cta:hover { transform: translateY(-2px); opacity: 0.92; }
.gv-snav .gv-langsw { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; padding: 2px; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; }
.gv-snav .gv-langsw + .gv-snav-cta { margin-left: 10px; }
.gv-snav-btn-reset { font: inherit; }
.gv-snav .gv-langsw-btn { appearance: none; background: transparent; border: none; cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 500; line-height: 1; color: #9a9d97; padding: 6px 9px; border-radius: 6px; transition: color .2s, background-color .2s; }
.gv-snav .gv-langsw-btn:hover { color: #f4f4f2; }
.gv-snav .gv-langsw-btn.on { background: rgba(255,255,255,0.1); color: #f4f4f2; cursor: default; }
@media (max-width: 700px) { .gv-snav-links { display: none; } .gv-snav-in { gap: 14px; padding: 14px 16px; } .gv-snav .gv-langsw { margin-left: 0; } }
`;

export default function SiteNav({
  /** True on the landing itself, where the section links are same-page hashes. */
  onLanding = false,
  /** The landing overlays its hero; every other page keeps the bar in flow. */
  position = 'sticky',
  ctaLabel,
  ctaHref = '/signup',
  /** Label of the item representing the current page, highlighted. */
  active,
  brandHref = '/',
  style,
  /** Language of the bar's own labels. `createT` rather than a context so this
   *  works unchanged in a server component (/blog) and a client one (Landing). */
  locale = 'en',
  /** Show the EN / 한국어 picker. Only the landing passes it — it navigates
   *  between the landing's per-language URLs, which are the only pages that
   *  exist in both. */
  langSwitch = false,
}: {
  onLanding?: boolean;
  position?: 'sticky' | 'fixed';
  ctaLabel?: string;
  ctaHref?: string;
  active?: string;
  brandHref?: string;
  style?: CSSProperties;
  locale?: UiLocale;
  langSwitch?: boolean;
}) {
  const t = createT(locale);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className={position === 'fixed' ? 'gv-snav gv-snav-fixed' : 'gv-snav'} style={style}>
        <div className="gv-snav-in">
          <a className="gv-snav-brand" href={brandHref}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/grove-mark.png" alt="" className="gv-snav-mark" />
            <span>Grove</span>
          </a>
          <div className="gv-snav-links">
            {SITE_NAV_LINKS.map((l) => (
              <a
                key={l.label}
                className="gv-snav-link"
                href={siteNavHref(l, onLanding)}
                aria-current={active === l.label ? 'page' : undefined}
              >
                {t(l.label)}
              </a>
            ))}
          </div>
          {langSwitch && <LangSwitch current={locale} />}
          <a className="gv-snav-cta" href={ctaHref}>
            {ctaLabel ?? t('Get Started')}
          </a>
        </div>
      </div>
    </>
  );
}
