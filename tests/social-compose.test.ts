import { describe, it, expect } from 'vitest';
import { composeShare, firstTweet, blogUrlFor, type PostForShare } from '../lib/social/compose';

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
});

describe('composeShare', () => {
  it('X: stays within 280 chars and ends with the URL', () => {
    const r = composeShare('x', post, url);
    expect(r.text.length).toBeLessThanOrEqual(280);
    expect(r.text.endsWith(url)).toBe(true);
  });

  it('X: clamps a very long hook', () => {
    const longPost = { ...post, social: { x: 'x'.repeat(500) } };
    const r = composeShare('x', longPost, url);
    expect(r.text.length).toBeLessThanOrEqual(280);
    expect(r.text).toContain('…');
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
