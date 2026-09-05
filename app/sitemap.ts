import type { MetadataRoute } from 'next';
import { appBase } from '@/lib/seo';
import { LANDING_LOCALES, landingAlternates } from '@/lib/landing-locale';

/**
 * Marketing sitemap. The per-blog sitemaps live under /b/[slug]/sitemap.xml;
 * this covers the marketing surface (home + legal), which was in NO sitemap
 * before — so the homepage, pricing, and FAQ had no crawl entry point.
 * login/signup are intentionally excluded (robots.txt disallows them).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBase();
  const now = new Date();

  // Every language of the landing is its own entry, each carrying the same
  // hreflang set as the pages themselves. A translation Google cannot find in
  // the sitemap is a translation that waits on being stumbled upon.
  const abs = Object.fromEntries(
    Object.entries(landingAlternates()).map(([k, path]) => [k, `${base}${path === '/' ? '/' : path}`]),
  );
  const landings: MetadataRoute.Sitemap = LANDING_LOCALES.map(({ path }) => ({
    url: `${base}${path === '/' ? '/' : path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: path === '/' ? 1 : 0.9,
    alternates: { languages: abs },
  }));

  return [
    ...landings,
    // The blog index. Articles themselves live in the per-blog sitemap under
    // /b/[slug]/sitemap.xml — this page only links to them.
    { url: `${base}/blog`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
