import type { MetadataRoute } from 'next';
import { appBase } from '@/lib/seo';

/**
 * Marketing sitemap. The per-blog sitemaps live under /b/[slug]/sitemap.xml;
 * this covers the marketing surface (home + legal), which was in NO sitemap
 * before — so the homepage, pricing, and FAQ had no crawl entry point.
 * login/signup are intentionally excluded (robots.txt disallows them).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appBase();
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
