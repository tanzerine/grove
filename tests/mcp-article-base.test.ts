/**
 * The one thing an MCP key can WRITE, and the fence around it.
 *
 * `set_article_base` moves `domains.canonical_blog_base`, and that column
 * decides where every absolute URL grove emits points — rel=canonical, Open
 * Graph, JSON-LD, sitemap <loc>, RSS items, llms.txt, social posts, embed card
 * links. Pointed at a domain the customer doesn't own, it would hand a
 * competitor the search credit for every article grove has ever written for
 * them, from a key sitting in a repo's config file.
 *
 * So the tool accepts the domain it belongs to, subdomains of it, and the
 * hostname already CNAME'd at grove — and nothing else. The dashboard, where a
 * human is looking at what they're doing, stays available for the genuinely
 * unusual case.
 */
import { describe, it, expect } from 'vitest';
import { baseBelongsToDomain, type McpDomain } from '@/lib/mcp/server';

const domain = (over: Partial<McpDomain> = {}): McpDomain => ({
  id: 'd1',
  hostname: 'acme.com',
  blog_slug: 'acme-com-ab12',
  canonical_blog_base: null,
  custom_blog_hostname: null,
  ...over,
});

describe('baseBelongsToDomain', () => {
  it('accepts the domain itself, with or without a path', () => {
    expect(baseBelongsToDomain(domain(), 'https://acme.com')).toBe(true);
    expect(baseBelongsToDomain(domain(), 'https://acme.com/blog')).toBe(true);
    expect(baseBelongsToDomain(domain(), 'https://acme.com/resources/articles')).toBe(true);
  });

  it('accepts any subdomain of it', () => {
    expect(baseBelongsToDomain(domain(), 'https://www.acme.com/blog')).toBe(true);
    expect(baseBelongsToDomain(domain(), 'https://blog.acme.com')).toBe(true);
    expect(baseBelongsToDomain(domain(), 'https://docs.eu.acme.com/blog')).toBe(true);
  });

  it('accepts the apex when the domain row is the www variant', () => {
    // Grove stores whichever hostname the customer connected; the apex and the
    // www host are the same site, and refusing one would depend on which they
    // happened to type at signup.
    expect(baseBelongsToDomain(domain({ hostname: 'www.acme.com' }), 'https://acme.com/blog')).toBe(true);
  });

  it('accepts the hostname already CNAME\'d at grove', () => {
    const d = domain({ hostname: 'acme.com', custom_blog_hostname: 'blog.acme-cdn.net' });
    expect(baseBelongsToDomain(d, 'https://blog.acme-cdn.net')).toBe(true);
  });

  it('refuses another domain, however similar it looks', () => {
    expect(baseBelongsToDomain(domain(), 'https://evil.com/blog')).toBe(false);
    // The suffix trap: notacme.com ends with "acme.com" as a STRING but is a
    // different registrable domain. Matching on `.endsWith(apex)` without the
    // dot would hand it every canonical URL grove emits.
    expect(baseBelongsToDomain(domain(), 'https://notacme.com/blog')).toBe(false);
    expect(baseBelongsToDomain(domain(), 'https://acme.com.evil.com/blog')).toBe(false);
  });

  it('refuses a base that is not a URL at all', () => {
    expect(baseBelongsToDomain(domain(), 'acme.com/blog')).toBe(false);
    expect(baseBelongsToDomain(domain(), '')).toBe(false);
    expect(baseBelongsToDomain(domain(), 'javascript:alert(1)')).toBe(false);
  });

  it('refuses everything when the domain row has no hostname', () => {
    expect(baseBelongsToDomain(domain({ hostname: '' }), 'https://acme.com')).toBe(false);
  });
});
