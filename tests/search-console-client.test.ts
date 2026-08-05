import { describe, it, expect } from 'vitest';
import { matchSite, domainProperty, verificationIdentifier, sitemapInProperty, type GscSite } from '../lib/search-console/client';

const site = (siteUrl: string, permissionLevel = 'siteOwner'): GscSite => ({ siteUrl, permissionLevel });

describe('domainProperty / verificationIdentifier', () => {
  it('normalizes host (strip www, lowercase) into the right shapes', () => {
    expect(domainProperty('www.Example.com')).toBe('sc-domain:example.com');
    expect(domainProperty('example.com')).toBe('sc-domain:example.com');
    expect(verificationIdentifier('WWW.Example.com')).toBe('example.com');
  });
});

describe('matchSite', () => {
  it('prefers the domain property over a url-prefix property', () => {
    const sites = [site('https://example.com/'), site('sc-domain:example.com')];
    expect(matchSite(sites, 'example.com')).toBe('sc-domain:example.com');
  });

  it('matches regardless of www on the hostname', () => {
    expect(matchSite([site('sc-domain:example.com')], 'www.example.com')).toBe('sc-domain:example.com');
  });

  it('falls back to a url-prefix property when there is no domain property', () => {
    expect(matchSite([site('https://example.com/')], 'example.com')).toBe('https://example.com/');
  });

  it('ignores properties the user has not verified', () => {
    const sites = [site('sc-domain:example.com', 'siteUnverifiedUser')];
    expect(matchSite(sites, 'example.com')).toBeNull();
  });

  it('returns null when nothing matches the domain', () => {
    expect(matchSite([site('sc-domain:other.com')], 'example.com')).toBeNull();
  });
});

describe('sitemapInProperty', () => {
  const P = 'sc-domain:acme.com';

  it('accepts a CNAMEd blog host inside the domain property', () => {
    // The case that makes submission worth doing: grove serves
    // blog.acme.com, and Google counts it as part of acme.com.
    expect(sitemapInProperty(P, 'https://blog.acme.com/sitemap.xml')).toBe(true);
  });

  it('accepts the apex itself', () => {
    expect(sitemapInProperty(P, 'https://acme.com/sitemap.xml')).toBe(true);
  });

  it('rejects the grove-hosted mirror against a customer property', () => {
    // Google will not accept a sitemap on a host the property doesn't cover —
    // skip it rather than retry a guaranteed 403 every day.
    expect(sitemapInProperty(P, 'https://trygroveai.com/b/acme-com-x1/sitemap.xml')).toBe(false);
  });

  it('is not fooled by a lookalike suffix', () => {
    expect(sitemapInProperty(P, 'https://notacme.com/sitemap.xml')).toBe(false);
    expect(sitemapInProperty(P, 'https://acme.com.evil.test/sitemap.xml')).toBe(false);
  });

  it('ignores case and a trailing dot on the property', () => {
    expect(sitemapInProperty('sc-domain:ACME.com.', 'https://Blog.Acme.com/sitemap.xml')).toBe(true);
  });

  it('honours a url-prefix property’s path', () => {
    const prefix = 'https://acme.com/blog';
    expect(sitemapInProperty(prefix, 'https://acme.com/blog/sitemap.xml')).toBe(true);
    expect(sitemapInProperty(prefix, 'https://acme.com/sitemap.xml')).toBe(false);
    expect(sitemapInProperty(prefix, 'https://other.com/blog/sitemap.xml')).toBe(false);
  });

  it('does not treat /blogger as being under /blog', () => {
    expect(sitemapInProperty('https://acme.com/blog', 'https://acme.com/blogger/sitemap.xml')).toBe(false);
  });

  it('rejects garbage rather than throwing', () => {
    expect(sitemapInProperty(P, 'not-a-url')).toBe(false);
    expect(sitemapInProperty('sc-domain:', 'https://acme.com/sitemap.xml')).toBe(false);
  });
});
