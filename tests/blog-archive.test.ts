import { describe, it, expect } from 'vitest';
import { archiveEntries, ARCHIVE_LINK_CAP } from '@/lib/blog-archive';

const post = (slug: string | null, title: string | null = `T ${slug}`) => ({
  slug,
  title,
  published_at: '2026-09-01T00:00:00Z',
});

describe('archiveEntries', () => {
  it('links every post, not just the first page', () => {
    // The defect this module exists for: the index paginated at 9 and exposed
    // 10 anchors out of 23, leaving the rest behind a ?page=N chain.
    const posts = Array.from({ length: 23 }, (_, i) => post(`p${i}`));
    const out = archiveEntries(posts, { blogSlug: 'acme-x1' });
    expect(out).toHaveLength(23);
  });

  it('builds absolute, canonical-aware URLs', () => {
    const [a] = archiveEntries([post('hello')], { blogSlug: 'acme-x1' });
    expect(a.url).toMatch(/\/b\/acme-x1\/hello$/);

    const [b] = archiveEntries([post('hello')], {
      blogSlug: 'acme-x1',
      canonicalBase: 'https://acme.com/blog',
    });
    // A customer who owns their canonical gets links to their own domain, so
    // the archive can never point readers at the mirror.
    expect(b.url).toBe('https://acme.com/blog/hello');
  });

  it('preserves input order rather than re-sorting', () => {
    const out = archiveEntries([post('c'), post('a'), post('b')], { blogSlug: 's' });
    expect(out.map((e) => e.slug)).toEqual(['c', 'a', 'b']);
  });

  it('drops rows with no slug — there is no URL to link', () => {
    const out = archiveEntries([post(null), post(''), post('  '), post('ok')], { blogSlug: 's' });
    expect(out.map((e) => e.slug)).toEqual(['ok']);
  });

  it('de-duplicates slugs so one article gets one link', () => {
    const out = archiveEntries([post('dup'), post('dup'), post('other')], { blogSlug: 's' });
    expect(out.map((e) => e.slug)).toEqual(['dup', 'other']);
  });

  it('falls back to the slug when a row has no title', () => {
    const out = archiveEntries([post('some-slug', null), post('x', '   ')], { blogSlug: 's' });
    expect(out.map((e) => e.title)).toEqual(['some-slug', 'x']);
  });

  it('caps link count, keeping the newest — input is newest-first', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(`p${i}`));
    const out = archiveEntries(posts, { blogSlug: 's', cap: 3 });
    expect(out.map((e) => e.slug)).toEqual(['p0', 'p1', 'p2']);
  });

  it('caps at ARCHIVE_LINK_CAP by default', () => {
    const posts = Array.from({ length: ARCHIVE_LINK_CAP + 25 }, (_, i) => post(`p${i}`));
    expect(archiveEntries(posts, { blogSlug: 's' })).toHaveLength(ARCHIVE_LINK_CAP);
  });

  it('returns nothing for a non-positive cap instead of everything', () => {
    expect(archiveEntries([post('a')], { blogSlug: 's', cap: 0 })).toEqual([]);
  });

  it('handles an empty blog', () => {
    expect(archiveEntries([], { blogSlug: 's' })).toEqual([]);
  });
});
