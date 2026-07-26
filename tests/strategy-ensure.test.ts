import { describe, it, expect } from 'vitest';
import { planningProfile } from '../lib/strategy/ensure';
import { blankProfile, type SiteProfile } from '../lib/pipeline/site-profile';

const crawled: SiteProfile = {
  ...blankProfile('acme.com', ['https://acme.com'], true, true),
  business: {
    name: 'Acme', industry: 'coffee', description: 'fresh beans',
    products_services: ['cold brew kit'], target_audience: 'home brewers',
    value_props: ['fresh'], geography: 'global',
  },
};

describe('planningProfile', () => {
  it('plans from a real crawled profile', () => {
    expect(planningProfile(crawled, 'acme.com')?.business.name).toBe('Acme');
  });

  it('refuses to plan with no profile when there is no fallback', () => {
    expect(planningProfile(null, 'acme.com')).toBeNull();
    expect(planningProfile(undefined, 'acme.com')).toBeNull();
  });

  it('falls back to a hostname-only profile when asked — a failed crawl must not cost a plan', () => {
    const p = planningProfile(null, 'acme.com', true);
    expect(p?.business.name).toBe('acme.com');
    expect(p?.voice.persona).toContain('acme.com');
  });

  it('treats a nameless profile as no profile at all', () => {
    // What a crawl that resolved to nothing usable leaves behind.
    const thin = { ...crawled, business: { ...crawled.business, name: '' } };
    expect(planningProfile(thin, 'acme.com')).toBeNull();
    expect(planningProfile(thin, 'acme.com', true)?.business.name).toBe('acme.com');
  });

  it('keeps the crawled profile even with the fallback available', () => {
    expect(planningProfile(crawled, 'acme.com', true)?.business.industry).toBe('coffee');
  });
});

describe('blankProfile', () => {
  it('is a complete SiteProfile, so every consumer can read it without guards', () => {
    const p = blankProfile('acme.com');
    expect(p.business.products_services).toEqual([]);
    expect(p.voice.samples).toEqual([]);
    expect(p.meta.pages_crawled).toEqual([]);
    expect(p.branding).toBeNull();
  });
});
