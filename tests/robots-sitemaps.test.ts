import { describe, it, expect } from 'vitest';
import { blogsToAdvertise, type SitemapCandidate } from '../lib/robots-sitemaps';

const d = (id: string, extra: Partial<SitemapCandidate> = {}): SitemapCandidate => ({
  id, blog_slug: `${id}-slug`, ...extra,
});

const slugs = (rows: SitemapCandidate[]) => rows.map((r) => r.blog_slug);

describe('blogsToAdvertise', () => {
  it('advertises a blog that has published something', () => {
    const rows = blogsToAdvertise({
      domains: [d('a')],
      domainsWithPosts: new Set(['a']),
      scanComplete: true,
    });
    expect(slugs(rows)).toEqual(['a-slug']);
  });

  it('drops a verified blog with no published posts', () => {
    // The production bug: robots.txt filtered on verified_at alone, so two QA
    // fixtures were submitted to Google with one empty blog home each.
    const rows = blogsToAdvertise({
      domains: [d('real'), d('qa')],
      domainsWithPosts: new Set(['real']),
      scanComplete: true,
    });
    expect(slugs(rows)).toEqual(['real-slug']);
  });

  it('drops every blog when none has published yet', () => {
    const rows = blogsToAdvertise({
      domains: [d('a'), d('b')],
      domainsWithPosts: new Set(),
      scanComplete: true,
    });
    expect(rows).toEqual([]);
  });

  it('still skips customer-owned canonical homes', () => {
    // Their sitemap is announced from their own robots.txt; advertising the
    // mirror here submits URLs that compete with the customer's copy.
    const rows = blogsToAdvertise({
      domains: [
        d('hosted'),
        d('owned', { canonical_blog_base: 'https://acme.com/blog' }),
        d('cnamed', { custom_blog_hostname: 'blog.acme.com' }),
      ],
      domainsWithPosts: new Set(['hosted', 'owned', 'cnamed']),
      scanComplete: true,
    });
    expect(slugs(rows)).toEqual(['hosted-slug']);
  });

  it('applies both filters together', () => {
    const rows = blogsToAdvertise({
      domains: [
        d('good'),
        d('empty'),
        d('owned', { canonical_blog_base: 'https://acme.com/blog' }),
      ],
      domainsWithPosts: new Set(['good', 'owned']),
      scanComplete: true,
    });
    expect(slugs(rows)).toEqual(['good-slug']);
  });

  it('fails OPEN on an incomplete scan rather than dropping a real sitemap', () => {
    // One extra empty sitemap is cheap; losing a paying customer's crawl entry
    // point because the scan hit its page cap is not.
    const rows = blogsToAdvertise({
      domains: [d('seen'), d('unseen')],
      domainsWithPosts: new Set(['seen']),
      scanComplete: false,
    });
    expect(slugs(rows)).toEqual(['seen-slug', 'unseen-slug']);
  });

  it('keeps the canonical filter even when failing open', () => {
    // Failing open is about "we don't know if it has posts" — it must never
    // resurrect a mirror that competes with the customer's own URLs.
    const rows = blogsToAdvertise({
      domains: [d('owned', { canonical_blog_base: 'https://acme.com/blog' })],
      domainsWithPosts: new Set(),
      scanComplete: false,
    });
    expect(rows).toEqual([]);
  });

  it('handles no domains at all', () => {
    expect(blogsToAdvertise({ domains: [], domainsWithPosts: new Set(), scanComplete: true })).toEqual([]);
  });
});
