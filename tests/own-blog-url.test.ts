/**
 * grove's own blog moved from /b/trygroveai-com-o6hf/* to /blog/*.
 *
 * Two halves, both pure: the builders (every canonical, sitemap, RSS, JSON-LD
 * and social URL for grove's row must say /blog) and the middleware route
 * table (/blog/* is served by the hosted routes, the old URLs 301 there). The
 * other half of each assertion is that a CUSTOMER's /b/{slug} is untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OWN_BLOG_SLUG, OWN_BLOG_PATH, appBase, blogHomeUrl, blogPostUrl, blogLinkBase, hostedBlogPath,
  ownBlogRoute, buildSitemapXml, buildRssXml, buildArticleGraph, canonicalBaseFor,
} from '../lib/seo';
import { embedSeoStatus } from '../lib/embed-seo';
import { sitemapIndexChildren } from '../lib/sitemap-index';

const OWN = OWN_BLOG_SLUG;

describe('builders: grove’s own blog lives at /blog', () => {
  const saved = process.env.GROVE_BLOG_ROOT_DOMAIN;
  beforeEach(() => { delete process.env.GROVE_BLOG_ROOT_DOMAIN; });
  afterEach(() => {
    if (saved === undefined) delete process.env.GROVE_BLOG_ROOT_DOMAIN;
    else process.env.GROVE_BLOG_ROOT_DOMAIN = saved;
  });

  it('is the trygroveai.com row', () => {
    expect(OWN).toBe('trygroveai-com-o6hf');
    expect(OWN_BLOG_PATH).toBe('/blog');
  });

  it('home, post and in-blog link base all say /blog', () => {
    expect(blogHomeUrl(OWN)).toBe(`${appBase()}/blog`);
    expect(blogPostUrl(OWN, 'my-post')).toBe(`${appBase()}/blog/my-post`);
    expect(blogLinkBase({}, OWN)).toBe('/blog');
    expect(hostedBlogPath(OWN)).toBe('/blog');
  });

  it('needs no canonical_blog_base, and agrees with one if it is ever set', () => {
    const row = { canonical_blog_base: null, custom_blog_hostname: null };
    expect(blogPostUrl(OWN, 'p', canonicalBaseFor(row))).toBe(`${appBase()}/blog/p`);
    const set = { canonical_blog_base: `${appBase()}/blog`, custom_blog_hostname: null };
    expect(blogPostUrl(OWN, 'p', canonicalBaseFor(set))).toBe(`${appBase()}/blog/p`);
  });

  it('wins over subdomain mode — grove’s blog stays on grove’s origin', () => {
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
    expect(blogHomeUrl(OWN)).toBe(`${appBase()}/blog`);
    expect(blogLinkBase({}, OWN)).toBe('/blog');
    expect(blogHomeUrl('demo')).toBe('https://demo.grove.so');
  });

  it('customers keep /b/{slug}', () => {
    expect(blogHomeUrl('acme-x1')).toBe(`${appBase()}/b/acme-x1`);
    expect(blogLinkBase({}, 'acme-x1')).toBe('/b/acme-x1');
    expect(hostedBlogPath('acme-x1')).toBe('/b/acme-x1');
    // a slug that merely CONTAINS the own slug is a different blog
    expect(hostedBlogPath(`${OWN}-2`)).toBe(`/b/${OWN}-2`);
  });

  it('sitemap, RSS and JSON-LD carry only the new URLs', () => {
    const sm = buildSitemapXml({ blogSlug: OWN, posts: [{ slug: 'a', published_at: '2026-10-01' }] });
    expect(sm).toContain(`<loc>${appBase()}/blog</loc>`);
    expect(sm).toContain(`<loc>${appBase()}/blog/a</loc>`);
    const rss = buildRssXml({ hostname: 'trygroveai.com', blogSlug: OWN, items: [{ slug: 'a', title: 'A' }] });
    expect(rss).toContain(`href="${appBase()}/blog/rss.xml"`);
    expect(rss).toContain(`<link>${appBase()}/blog/a</link>`);
    const ld = JSON.stringify(buildArticleGraph({
      hostname: 'trygroveai.com', blogSlug: OWN, postSlug: 'a', title: 'A', businessName: 'grove',
      homeUrl: 'https://trygroveai.com', authorName: 'grove', authorIsOrg: true, genreLabel: 'Guide', wordCount: 10,
    }));
    for (const out of [sm, rss, ld]) expect(out).not.toContain('/b/');
  });

  it('the root sitemap index lists /blog/sitemap.xml as a same-origin child', () => {
    const kids = sitemapIndexChildren({ appBase: appBase(), blogHomeUrls: [blogHomeUrl(OWN), blogHomeUrl('acme-x1')] });
    expect(kids).toContain(`${appBase()}/blog/sitemap.xml`);
    expect(kids).toContain(`${appBase()}/b/acme-x1/sitemap.xml`);
  });

  it('the embed status for grove’s row points cards at /blog', () => {
    const s = embedSeoStatus({ hostname: 'trygroveai.com', blog_slug: OWN }, 'https://trygroveai.com');
    expect(s.state).toBe('app-origin');
    expect(s.articleBase).toBe('https://trygroveai.com/blog');
  });
});

describe('ownBlogRoute (middleware)', () => {
  it('rewrites /blog and everything under it onto the hosted routes', () => {
    expect(ownBlogRoute('/blog')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}` });
    expect(ownBlogRoute('/blog/')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}` });
    expect(ownBlogRoute('/blog/my-post')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}/my-post` });
    expect(ownBlogRoute('/blog/sitemap.xml')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}/sitemap.xml` });
    expect(ownBlogRoute('/blog/rss.xml')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}/rss.xml` });
    expect(ownBlogRoute('/blog/my-post/og')).toEqual({ action: 'rewrite', pathname: `/b/${OWN}/my-post/og` });
  });

  it('301s every old /b/{own}/* URL to the same path under /blog', () => {
    expect(ownBlogRoute(`/b/${OWN}`)).toEqual({ action: 'redirect', pathname: '/blog' });
    expect(ownBlogRoute(`/b/${OWN}/`)).toEqual({ action: 'redirect', pathname: '/blog' });
    expect(ownBlogRoute(`/b/${OWN}/my-post`)).toEqual({ action: 'redirect', pathname: '/blog/my-post' });
    expect(ownBlogRoute(`/b/${OWN}/sitemap.xml`)).toEqual({ action: 'redirect', pathname: '/blog/sitemap.xml' });
    expect(ownBlogRoute(`/b/${OWN}/rss.xml`)).toEqual({ action: 'redirect', pathname: '/blog/rss.xml' });
  });

  it('a rewrite target is never itself redirected back (no loop)', () => {
    // middleware sees the ORIGINAL path; the rewritten /b/{own} never re-enters
    // it, but the table must not map its own outputs onto each other either.
    const r = ownBlogRoute('/blog/x')!;
    const back = ownBlogRoute(r.pathname)!;
    expect(back.pathname).toBe('/blog/x');
    expect(back.action).toBe('redirect');
  });

  it('leaves customer mirrors and look-alike paths alone', () => {
    expect(ownBlogRoute('/b/acme-x1')).toBeNull();
    expect(ownBlogRoute('/b/acme-x1/post')).toBeNull();
    expect(ownBlogRoute(`/b/${OWN}-2/post`)).toBeNull();
    expect(ownBlogRoute('/blogging-tips')).toBeNull();
    expect(ownBlogRoute('/')).toBeNull();
    expect(ownBlogRoute('/dashboard')).toBeNull();
  });
});
