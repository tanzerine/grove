/**
 * Chrome for a blog grove HOSTS.
 *
 * These pages are the surface a customer reaches through the dashboard's
 * "Step 1 · Own the SEO" — grove serves the whole blog on their subdomain via
 * `domains.custom_blog_hostname`. Until now it rendered in grove's own clothes:
 * the root layout's Inter / GT Walsheim / DM Mono, a --bone background, and no
 * navigation at all beyond a `← hostname` link on the article page. A reader
 * arriving from the customer's site had no way back to it and no sign they
 * were still somewhere the customer owned.
 *
 * The embed solves this by measuring the page it's mounted in. There is no such
 * page here — grove renders this one end to end — so the design comes from the
 * homepage capture instead (lib/site-design.ts), taken during profiling.
 *
 * Everything degrades: no capture means grove's own look, which is exactly what
 * these pages did before. A partial capture applies the part it has.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { designCss, isFontStylesheet, type SiteDesign } from '@/lib/site-design';
import { blogThemeVars, resolveBranding } from '@/lib/blog-theme';
import { subdomainSlugFromHost, isCustomBlogHost } from '@/lib/seo';
import { headers } from 'next/headers';
import { cache } from 'react';

/**
 * Deduped per request: the page components below run their own `domains`
 * lookup, and React's cache collapses this into the same round trip rather
 * than doubling a query on every article render.
 */
const loadDomain = cache(async (slug: string) => {
  const sb = supabaseAdmin();
  // select('*') for the same reason the pages do — naming a column that hasn't
  // been migrated yet would 404 the whole blog.
  const { data } = await sb.from('domains').select('*').eq('blog_slug', slug).single();
  return data;
});

export default async function HostedBlogLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const domain = await loadDomain(slug);
  const design = ((domain as any)?.site_profile?.design ?? null) as SiteDesign | null;

  /**
   * The brand accent has to be declared at :root, not only on the pages.
   * blogThemeVars is applied by each page as an inline style on <main>, which
   * covers the article but leaves this nav — a sibling of <main> — reading
   * grove's default moss green. Declaring it here themes both; the pages' own
   * inline copy still wins inside <main>, so nothing they do changes.
   */
  // Passed the captured colors so the accent is corrected against the page it
  // will actually sit on — a dark customer site otherwise gets a dark blog with
  // a dark accent, and the links and genre tags disappear into it — and so the
  // CTA banner is built from the site's own surface instead of a darkened brand
  // color (see blogThemeVars).
  const brand = blogThemeVars(resolveBranding(domain), design?.colors);
  const brandCss = brand
    ? `:root{${Object.entries(brand).map(([k, v]) => `${k}:${v}`).join(';')}}`
    : '';
  const css = [brandCss, designCss(design) ?? ''].filter(Boolean).join('');
  // Re-validated at render time rather than trusted from the column — see
  // isFontStylesheet. Capped so a malformed capture can't add ten blocking
  // stylesheets to every article.
  const fonts = (design?.fonts.stylesheets ?? []).filter(isFontStylesheet).slice(0, 4);

  // On a blog host the middleware strips the /b/{slug} prefix, so the blog's
  // own links must be root-relative there and prefixed on the app host.
  const host = (await headers()).get('host');
  const onBlogHost = !!subdomainSlugFromHost(host) || isCustomBlogHost(host, domain);
  const blogHome = onBlogHost ? '/' : `/b/${slug}`;

  const nav = design?.nav ?? null;
  const siteName =
    nav?.brand.text ||
    (domain as any)?.site_profile?.business?.name ||
    domain?.hostname?.replace(/^www\./, '') ||
    null;
  const siteHome = nav?.brand.href || (domain?.hostname ? `https://${domain.hostname}` : null);

  return (
    <>
      {/* React 19 hoists these into <head>; the customer's own faces have to
          be loading before the first paint of their type. */}
      {fonts.map((href) => (
        <link key={href} rel="stylesheet" href={href} />
      ))}
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}

      {siteName && (
        <header className="hosted-nav">
          <div className="hosted-nav-in">
            {/* Mark AND wordmark, the shape the landing's bar uses. A captured
                logo is usually an icon sitting next to the name, so rendering
                only one of the two loses half the lockup. */}
            <a className="hosted-nav-brand" href={siteHome ?? blogHome}>
              {nav?.brand.logo && (
                // Not next/image: this is an arbitrary customer-hosted asset on
                // a domain the optimizer isn't configured for, and a broken
                // optimize step would blank the logo on every page.
                // eslint-disable-next-line @next/next/no-img-element
                // alt="": the name is rendered as text right beside it, so a
                // described image would just say it twice.
                <img src={nav.brand.logo} alt="" className="hosted-nav-logo" />
              )}
              <span>{siteName}</span>
            </a>
            <nav className="hosted-nav-links">
              {(nav?.links ?? []).map((l) => (
                <a key={l.href + l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
              {/* The blog is the page we're on, and a captured nav often already
                  links to it on the customer's own site — so it's added only
                  when their nav didn't already carry one. */}
              {!(nav?.links ?? []).some((l) => /blog|articles|insights|journal/i.test(l.label)) && (
                <a href={blogHome}>Blog</a>
              )}
            </nav>
            {nav?.cta && (
              <a className="hosted-nav-cta" href={nav.cta.href}>
                {nav.cta.label}
              </a>
            )}
          </div>
        </header>
      )}

      {children}
    </>
  );
}

/**
 * The root layout templates every title as `%s · grove`, which on a customer's
 * own subdomain put grove's name in the browser tab and the search result of
 * every article they published. Re-point the template at the business the blog
 * actually belongs to.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const domain = await loadDomain(slug);
  const name =
    (domain as any)?.site_profile?.business?.name ||
    domain?.hostname?.replace(/^www\./, '') ||
    '';
  return name ? { title: { template: `%s · ${name}`, default: name } } : {};
}
