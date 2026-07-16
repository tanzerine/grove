import { describe, it, expect } from 'vitest';
import {
  composeShare, firstTweet, blogUrlFor, xLen, clampX, X_MAX, X_URL_WEIGHT,
  type PostForShare,
} from '../lib/social/compose';

// Weighted length of a full composed X post, the way X's server counts it:
// the trailing URL costs a flat 23 regardless of its printed length.
function xPostLen(text: string, url: string): number {
  return xLen(text.slice(0, text.length - url.length)) + X_URL_WEIGHT;
}

const post: PostForShare = {
  id: 'p1',
  title: 'How we render icons fast',
  slug: 'how-we-render-icons-fast',
  social: { x: '1. Speed is everything here\n2. second tweet', linkedin: 'A LinkedIn take.', instagram: 'IG caption.' },
  cover_image_url: 'https://img.example.com/cover.png',
};
const url = 'https://demo.grove.so/how-we-render-icons-fast';

describe('firstTweet', () => {
  it('strips numbering and takes the first real line', () => {
    expect(firstTweet('1. Hello world\n2. nope')).toBe('Hello world');
  });

  it('accepts a Korean-only hook (no Latin letters)', () => {
    expect(firstTweet('1. 배경 제거는 이제 원탭\n2. 다음')).toBe('배경 제거는 이제 원탭');
  });
});

describe('xLen — X weighted counting', () => {
  it('counts ASCII as 1 per char', () => {
    expect(xLen('hello world')).toBe(11);
  });
  it('counts CJK and emoji as 2 per char', () => {
    expect(xLen('배경제거')).toBe(8);   // 4 Hangul syllables (> U+10FF)
    expect(xLen('🚀')).toBe(2);
    expect(xLen('…')).toBe(2);          // U+2026 is outside the weight-1 ranges
  });
});

describe('clampX', () => {
  it('returns short text untouched', () => {
    expect(clampX('short hook', 100)).toBe('short hook');
  });
  it('cuts at a word boundary, never mid-word', () => {
    const out = clampX('alpha bravo charlie delta echo foxtrot', 20);
    expect(out.endsWith('…')).toBe(true);
    // every kept word must be one of the originals, uncut
    for (const w of out.slice(0, -1).trim().split(/\s+/)) {
      expect(['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']).toContain(w);
    }
    expect(xLen(out)).toBeLessThanOrEqual(20);
  });
  it('hard-cuts unspaced text (CJK) within the weighted budget', () => {
    const out = clampX('가'.repeat(200), 50);
    expect(xLen(out)).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('composeShare', () => {
  it('X: stays within the 280 weighted budget and ends with the URL', () => {
    const r = composeShare('x', post, url);
    expect(xPostLen(r.text, url)).toBeLessThanOrEqual(X_MAX);
    expect(r.text.endsWith(url)).toBe(true);
  });

  it('X: clamps a very long hook within the weighted budget', () => {
    const longPost = { ...post, social: { x: 'word '.repeat(100) } };
    const r = composeShare('x', longPost, url);
    expect(xPostLen(r.text, url)).toBeLessThanOrEqual(X_MAX);
    expect(r.text).toContain('…');
  });

  it('X: a long printed URL does not shrink the text budget (t.co counts 23)', () => {
    const longUrl = 'https://www.oveners.com/blog/' + 'seo-slug-'.repeat(10);
    const hook = 'h'.repeat(300);
    const r = composeShare('x', { ...post, social: { x: hook } }, longUrl);
    // budget for text is X_MAX - 23 - 2 = 255, so ~253 chars survive + '…';
    // the old url.length-based math would have kept only ~157.
    const kept = r.text.split('\n\n')[0];
    expect(xLen(kept)).toBeGreaterThan(200);
    expect(xLen(kept)).toBeLessThanOrEqual(X_MAX - X_URL_WEIGHT - 2);
  });

  it('X: a Korean hook is budgeted by weight (2 per syllable), not length', () => {
    const hook = '가'.repeat(300); // weighted 600 → must clamp to ≤255
    const r = composeShare('x', { ...post, social: { x: hook } }, url);
    expect(xPostLen(r.text, url)).toBeLessThanOrEqual(X_MAX);
  });

  it('LinkedIn: includes the commentary and the link', () => {
    const r = composeShare('linkedin', post, url);
    expect(r.text).toContain('A LinkedIn take.');
    expect(r.text).toContain(url);
  });

  it('Instagram: carries the cover image', () => {
    const r = composeShare('instagram', post, url);
    expect(r.imageUrl).toBe('https://img.example.com/cover.png');
    expect(r.text).toContain('IG caption.');
  });

  it('falls back to the title when no social copy exists', () => {
    const bare = { ...post, social: null };
    expect(composeShare('x', bare, url).text).toContain('How we render icons fast');
  });
});

describe('blogUrlFor', () => {
  it('uses the subdomain when a root domain is set', () => {
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
    expect(blogUrlFor({ blog_slug: 'demo' }, 'my-post')).toBe('https://demo.grove.so/my-post');
  });

  it('shares the customer-hosted URL when canonical_blog_base is set', () => {
    process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
    const domain = { blog_slug: 'demo', canonical_blog_base: 'https://acme.com/blog' };
    expect(blogUrlFor(domain, 'my-post')).toBe('https://acme.com/blog/my-post');
    expect(blogUrlFor(domain, null)).toBe('https://acme.com/blog');
  });
});
