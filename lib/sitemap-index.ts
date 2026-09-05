/**
 * The root sitemap, as a sitemap INDEX.
 *
 * WHY. `/sitemap.xml` used to be a urlset holding five marketing URLs, and the
 * per-blog sitemaps that hold every actual article were announced only as extra
 * `Sitemap:` lines in robots.txt. That works — Google did discover the article
 * URLs that way — but it is the weakest form of submission available: a
 * robots.txt directive is a hint picked up whenever robots.txt is re-fetched,
 * with no lastmod, no grouping, and no place in Search Console's sitemap
 * reporting. A sitemap index is the submitted, first-class version of the same
 * statement, and it makes every hosted blog a child of one URL the owner can
 * paste into Search Console.
 *
 * SAME-ORIGIN ONLY, and that is the whole subtlety here. A sitemap index may
 * only reference sitemaps on its own host; Google ignores cross-host children.
 * With `GROVE_BLOG_ROOT_DOMAIN` set, `blogHomeUrl()` returns
 * `{slug}.{root}` — a different host — and with a customer-owned
 * `canonical_blog_base` it returns the customer's domain entirely. Those blogs
 * are correctly announced by robots.txt cross-submission (and by their own
 * origin's robots.txt), so they are FILTERED OUT here rather than emitted as
 * children Google would silently drop. robots.txt keeps advertising them; this
 * index carries the ones grove actually serves from its own origin.
 */

/** Origin (scheme + host + port) of a URL, lowercased; null when unparseable. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The children of the root sitemap index.
 *
 * `${appBase}/pages.xml` always comes first — it holds the marketing surface
 * (landings + legal), which is the only part of the site that is not a blog.
 * Blog sitemaps follow in the order given, de-duplicated, same-origin only.
 */
export function sitemapIndexChildren(input: {
  appBase: string;
  /** Blog HOME urls, e.g. `https://grove.com/b/acme-x1` — `/sitemap.xml` is appended. */
  blogHomeUrls: string[];
}): string[] {
  const base = input.appBase.replace(/\/$/, '');
  const origin = originOf(base);
  const out = [`${base}/pages.xml`];
  const seen = new Set(out);

  for (const home of input.blogHomeUrls) {
    const trimmed = (home ?? '').trim().replace(/\/$/, '');
    if (!trimmed) continue;
    const loc = `${trimmed}/sitemap.xml`;
    // Cross-host children are ignored by Google inside an index; emitting them
    // would look like coverage while providing none.
    if (originOf(loc) !== origin) continue;
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }

  return out;
}

/** Serialize a sitemap index. `lastmod` is optional and applies to every child. */
export function buildSitemapIndexXml(children: string[], lastmod?: string | null): string {
  const mod = lastmod ? `<lastmod>${escapeXmlLocal(lastmod.slice(0, 10))}</lastmod>` : '';
  const entries = children
    .map((loc) => `<sitemap><loc>${escapeXmlLocal(loc)}</loc>${mod}</sitemap>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`;
}

export type UrlsetEntry = {
  url: string;
  lastModified?: string | null;
  changeFrequency?: string | null;
  priority?: number | null;
  /** hreflang code → absolute URL. */
  alternates?: Record<string, string>;
};

/**
 * Serialize a urlset, hreflang included.
 *
 * Hand-built rather than delegated to Next's `MetadataRoute.Sitemap`, because
 * that helper owns `/sitemap.xml` — the URL this refactor needs for the index.
 * The alternate links are the reason it cannot just call `buildSitemapXml`
 * from lib/seo: that one is post-shaped (image children, no hreflang).
 */
export function buildUrlsetXml(entries: UrlsetEntry[]): string {
  const body = entries
    .map((e) => {
      const alts = Object.entries(e.alternates ?? {})
        .map(
          ([lang, href]) =>
            `<xhtml:link rel="alternate" hreflang="${escapeXmlLocal(lang)}" href="${escapeXmlLocal(href)}"/>`,
        )
        .join('');
      const mod = e.lastModified ? `<lastmod>${escapeXmlLocal(e.lastModified)}</lastmod>` : '';
      const freq = e.changeFrequency ? `<changefreq>${escapeXmlLocal(e.changeFrequency)}</changefreq>` : '';
      const pri = e.priority != null ? `<priority>${e.priority}</priority>` : '';
      return `<url><loc>${escapeXmlLocal(e.url)}</loc>${alts}${mod}${freq}${pri}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>`;
}

/** Local copy of lib/seo's escaper — this module stays dependency-free so it
 *  can be unit-tested without the env that `appBase()` reads. */
function escapeXmlLocal(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
