import { describe, it, expect } from 'vitest';
import { matchSite, domainProperty, verificationIdentifier, type GscSite } from '../lib/search-console/client';

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
