import { describe, it, expect } from 'vitest';
import { socialProfileUrl, extractSocialProfiles, sameAsFor } from '../lib/org-identity';

describe('socialProfileUrl', () => {
  it('accepts real profile shapes on every known host', () => {
    expect(socialProfileUrl('https://twitter.com/groveai')).toBe('https://twitter.com/groveai');
    expect(socialProfileUrl('https://x.com/groveai')).toBe('https://x.com/groveai');
    expect(socialProfileUrl('https://www.linkedin.com/company/groveai')).toBe('https://linkedin.com/company/groveai');
    expect(socialProfileUrl('https://linkedin.com/in/some-founder')).toBe('https://linkedin.com/in/some-founder');
    expect(socialProfileUrl('https://www.youtube.com/@groveai')).toBe('https://youtube.com/@groveai');
    expect(socialProfileUrl('https://youtube.com/channel/UCabc123')).toBe('https://youtube.com/channel/UCabc123');
    expect(socialProfileUrl('https://instagram.com/oven.ai')).toBe('https://instagram.com/oven.ai');
    expect(socialProfileUrl('https://github.com/tanzerine')).toBe('https://github.com/tanzerine');
    expect(socialProfileUrl('https://www.tiktok.com/@someone')).toBe('https://tiktok.com/@someone');
    expect(socialProfileUrl('https://www.crunchbase.com/organization/grove')).toBe('https://crunchbase.com/organization/grove');
  });

  // The failure this whole module exists to prevent. Every one of these strings
  // was read back as a "social profile" by a real AI-readiness crawl of
  // blog.oveners.com, because grove renders share buttons on every article.
  it('rejects share and compose URLs', () => {
    expect(socialProfileUrl('https://twitter.com/intent/tweet?text=Hello&url=https%3A%2F%2Fx.co')).toBeNull();
    expect(socialProfileUrl('https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fx.co')).toBeNull();
    expect(socialProfileUrl('https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fx.co')).toBeNull();
    expect(socialProfileUrl('https://x.com/share?url=https://x.co')).toBeNull();
  });

  // The second failure mode: grove's WRITER cites these constantly, so any
  // extractor that ran over an article body would claim them as the customer's.
  it('rejects third-party content permalinks', () => {
    expect(socialProfileUrl('https://www.youtube.com/watch?v=pNiSogNtLWc')).toBeNull();
    expect(socialProfileUrl('https://www.linkedin.com/posts/drnickfine_this-is-wrong-activity-745827')).toBeNull();
    expect(socialProfileUrl('https://www.linkedin.com/pulse/prioritization-pitfalls-4-common')).toBeNull();
    expect(socialProfileUrl('https://www.facebook.com/groups/482533505156388/posts/26143280948654958')).toBeNull();
    expect(socialProfileUrl('https://www.instagram.com/p/Cxyz123/')).toBeNull();
    expect(socialProfileUrl('https://www.tiktok.com/@user/video/7551857926248631574')).toBeNull();
  });

  it('rejects a percent-encoded share path that would slip past a raw match', () => {
    expect(socialProfileUrl('https://twitter.com/%69ntent/tweet?text=hi')).toBeNull();
  });

  it('rejects unknown hosts, bare hosts and non-http schemes', () => {
    expect(socialProfileUrl('https://example.com/groveai')).toBeNull();
    expect(socialProfileUrl('https://twitter.com')).toBeNull();
    expect(socialProfileUrl('https://twitter.com/')).toBeNull();
    expect(socialProfileUrl('javascript:alert(1)')).toBeNull();
    expect(socialProfileUrl('mailto:hi@example.com')).toBeNull();
    expect(socialProfileUrl('')).toBeNull();
  });

  it('normalizes host case, www and tracking query so one account dedupes', () => {
    expect(socialProfileUrl('https://WWW.Twitter.com/GroveAI/?ref=footer&utm_source=x'))
      .toBe('https://twitter.com/GroveAI');
    expect(socialProfileUrl('http://m.instagram.com/oven.ai/')).toBe('https://instagram.com/oven.ai');
  });

  it('resolves relative hrefs against the page base and still rejects them', () => {
    // A relative href is by definition same-origin, so it can never be a profile.
    expect(socialProfileUrl('/about', 'https://acme.com')).toBeNull();
  });
});

describe('extractSocialProfiles', () => {
  it('pulls only anchor profiles out of homepage markup', () => {
    const html = `
      <header><a href="/">Home</a></header>
      <footer>
        <a class="ico" href="https://twitter.com/acme">X</a>
        <a href="https://www.linkedin.com/company/acme">LinkedIn</a>
        <a href="https://www.linkedin.com/sharing/share-offsite/?url=https://acme.com">Share</a>
        <a href="https://acme.com/contact">Contact</a>
      </footer>`;
    expect(extractSocialProfiles(html, 'https://acme.com')).toEqual([
      'https://linkedin.com/company/acme',
      'https://twitter.com/acme',
    ]);
  });

  it('ignores social hosts that appear outside an anchor href', () => {
    // Exactly what trygroveai.com's homepage looks like: twitter:card meta tags
    // and the words "Posts to X and LinkedIn" as marketing copy. Verified live —
    // both grove's and oveners' homepages yield zero profiles by this rule.
    const html = `
      <meta name="twitter:card" content="summary_large_image"/>
      <meta name="twitter:title" content="grove"/>
      <div><span>Posts to X and</span><span>LinkedIn for you</span></div>`;
    expect(extractSocialProfiles(html)).toEqual([]);
  });

  it('dedupes two spellings of one account and returns a stable order', () => {
    const html = `
      <a href="https://x.com/acme">a</a>
      <a href="https://www.x.com/acme/?utm_source=nav">b</a>
      <a href="https://github.com/acme">c</a>`;
    const out = extractSocialProfiles(html);
    expect(out).toEqual(['https://github.com/acme', 'https://x.com/acme']);
    expect(extractSocialProfiles(html)).toEqual(out); // stable across runs
  });

  it('survives empty and malformed input', () => {
    expect(extractSocialProfiles('')).toEqual([]);
    expect(extractSocialProfiles('<a href=>')).toEqual([]);
    expect(extractSocialProfiles(undefined as unknown as string)).toEqual([]);
  });
});

describe('sameAsFor', () => {
  it('reads profiles off a stored site_profile', () => {
    expect(sameAsFor({ business: { profiles: ['https://twitter.com/acme'] } }))
      .toEqual(['https://twitter.com/acme']);
  });

  it('re-validates on the way out, so a bad stored row cannot emit a false claim', () => {
    const stored = {
      business: {
        profiles: [
          'https://twitter.com/intent/tweet?text=hi',   // share button
          'https://www.youtube.com/watch?v=abc',        // a citation
          'https://linkedin.com/company/acme',          // genuine
          42,                                           // not a string
        ],
      },
    };
    expect(sameAsFor(stored)).toEqual(['https://linkedin.com/company/acme']);
  });

  it('returns nothing for the profiles written before this field existed', () => {
    expect(sameAsFor({ business: { name: 'Acme' } })).toEqual([]);
    expect(sameAsFor({})).toEqual([]);
    expect(sameAsFor(null)).toEqual([]);
    expect(sameAsFor(undefined)).toEqual([]);
    expect(sameAsFor({ business: { profiles: 'not-an-array' } })).toEqual([]);
  });
});
