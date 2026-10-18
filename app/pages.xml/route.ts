/**
 * The MARKETING child of the root sitemap index — landings + legal.
 *
 * This is what `app/sitemap.ts` used to serve at `/sitemap.xml`, moved so the
 * root URL can be a sitemap index (see `app/sitemap.xml/route.ts`). Nothing
 * about the content changed: same pages, same hreflang set, same priorities.
 * login/signup stay out because robots.txt disallows them.
 */
import { appBase } from '@/lib/seo';
import { LANDING_LOCALES, landingAlternates } from '@/lib/landing-locale';
import { buildUrlsetXml, type UrlsetEntry } from '@/lib/sitemap-index';

export async function GET() {
  const base = appBase();
  const now = new Date().toISOString();

  // Every language of the landing is its own entry, each carrying the same
  // hreflang set as the pages themselves. A translation Google cannot find in
  // the sitemap is a translation that waits on being stumbled upon.
  const abs = Object.fromEntries(
    Object.entries(landingAlternates()).map(([k, path]) => [k, `${base}${path === '/' ? '/' : path}`]),
  );
  const landings: UrlsetEntry[] = LANDING_LOCALES.map(({ path }) => ({
    url: `${base}${path === '/' ? '/' : path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: path === '/' ? 1 : 0.9,
    alternates: abs,
  }));

  const xml = buildUrlsetXml([
    ...landings,
    // No /blog entry: the blog hub is the first <url> of /blog/sitemap.xml (a
    // sibling of this file in the root index), with a real lastmod. Listing it
    // here too only duplicated it.
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]);

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml',
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
