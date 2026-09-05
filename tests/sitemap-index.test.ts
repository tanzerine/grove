import { describe, it, expect } from 'vitest';
import { sitemapIndexChildren, buildSitemapIndexXml, buildUrlsetXml } from '@/lib/sitemap-index';

const BASE = 'https://grove.example';

describe('sitemapIndexChildren', () => {
  it('always leads with the marketing child', () => {
    const out = sitemapIndexChildren({ appBase: BASE, blogHomeUrls: [] });
    expect(out).toEqual([`${BASE}/pages.xml`]);
  });

  it('appends /sitemap.xml to each blog home', () => {
    const out = sitemapIndexChildren({
      appBase: BASE,
      blogHomeUrls: [`${BASE}/b/acme-x1`, `${BASE}/b/beta-y2`],
    });
    expect(out).toEqual([
      `${BASE}/pages.xml`,
      `${BASE}/b/acme-x1/sitemap.xml`,
      `${BASE}/b/beta-y2/sitemap.xml`,
    ]);
  });

  it('drops cross-host children — an index may only reference its own host', () => {
    // Both of these are real shapes: a customer-owned canonical base, and a
    // {slug}.{root} subdomain when GROVE_BLOG_ROOT_DOMAIN is set. Google
    // ignores them inside an index, so emitting them would look like coverage
    // while providing none. robots.txt cross-submission is their mechanism.
    const out = sitemapIndexChildren({
      appBase: BASE,
      blogHomeUrls: [
        'https://acme.com/blog',
        'https://acme-x1.blogs.example',
        `${BASE}/b/kept-z3`,
      ],
    });
    expect(out).toEqual([`${BASE}/pages.xml`, `${BASE}/b/kept-z3/sitemap.xml`]);
  });

  it('de-duplicates and ignores blank or unparseable entries', () => {
    const out = sitemapIndexChildren({
      appBase: BASE,
      blogHomeUrls: [`${BASE}/b/a`, `${BASE}/b/a/`, '', '   ', 'not a url'],
    });
    expect(out).toEqual([`${BASE}/pages.xml`, `${BASE}/b/a/sitemap.xml`]);
  });

  it('tolerates a trailing slash on the app base', () => {
    expect(sitemapIndexChildren({ appBase: `${BASE}/`, blogHomeUrls: [`${BASE}/b/a`] })).toEqual([
      `${BASE}/pages.xml`,
      `${BASE}/b/a/sitemap.xml`,
    ]);
  });

  it('matches origin case-insensitively but not across ports', () => {
    expect(
      sitemapIndexChildren({ appBase: BASE, blogHomeUrls: ['https://GROVE.example/b/a'] }),
    ).toContain(`https://GROVE.example/b/a/sitemap.xml`);
    expect(
      sitemapIndexChildren({ appBase: BASE, blogHomeUrls: ['https://grove.example:8443/b/a'] }),
    ).toEqual([`${BASE}/pages.xml`]);
  });
});

describe('buildSitemapIndexXml', () => {
  it('emits a sitemapindex, not a urlset', () => {
    const xml = buildSitemapIndexXml([`${BASE}/pages.xml`]);
    expect(xml).toContain('<sitemapindex');
    expect(xml).not.toContain('<urlset');
    expect(xml).toContain(`<loc>${BASE}/pages.xml</loc>`);
  });

  it('applies lastmod to every child when given, trimmed to a date', () => {
    const xml = buildSitemapIndexXml([`${BASE}/a.xml`, `${BASE}/b.xml`], '2026-09-05T04:00:00Z');
    expect(xml.match(/<lastmod>2026-09-05<\/lastmod>/g)).toHaveLength(2);
  });

  it('escapes ampersands so the document stays well-formed', () => {
    expect(buildSitemapIndexXml([`${BASE}/a.xml?x=1&y=2`])).toContain('&amp;y=2');
  });
});

describe('buildUrlsetXml', () => {
  it('emits hreflang alternates — the reason it is not buildSitemapXml', () => {
    const xml = buildUrlsetXml([
      { url: `${BASE}/`, alternates: { en: `${BASE}/`, ko: `${BASE}/ko` }, priority: 1 },
    ]);
    expect(xml).toContain('xmlns:xhtml=');
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="ko" href="${BASE}/ko"/>`);
    expect(xml).toContain('<priority>1</priority>');
  });

  it('omits optional fields rather than emitting empty tags', () => {
    const xml = buildUrlsetXml([{ url: `${BASE}/terms` }]);
    expect(xml).toContain(`<url><loc>${BASE}/terms</loc></url>`);
    expect(xml).not.toContain('<lastmod>');
    expect(xml).not.toContain('<priority>');
  });
});
