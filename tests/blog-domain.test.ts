import { describe, it, expect } from 'vitest';
import { pickBlogDomain, compareBlogDomain, type DomainCandidate } from '../lib/blog-domain';

// A hostname can resolve to more than one `domains` row. pickBlogDomain must
// never let an empty/duplicate row hijack a populated blog, even when the
// duplicate is verified more recently.
describe('pickBlogDomain', () => {
  it('returns null for no candidates', () => {
    expect(pickBlogDomain([])).toBeNull();
    expect(pickBlogDomain(null as any)).toBeNull();
  });

  it('returns the only candidate unchanged', () => {
    const only = { published_count: 0, verified_at: null };
    expect(pickBlogDomain([only])).toBe(only);
  });

  it('prefers the row with published content over an empty duplicate', () => {
    // The real oveners.com scenario: the empty duplicate is verified NEWER, but
    // owns zero posts — it must NOT win.
    const real = {
      id: '85lu',
      published_count: 34,
      verified_at: '2026-06-02T00:00:00Z',
      custom_blog_hostname: 'blog.oveners.com',
    };
    const emptyDuplicate = {
      id: 'cq9q',
      published_count: 0,
      verified_at: '2026-08-01T00:00:00Z', // verified LATER than the real one
      custom_blog_hostname: null,
    };
    expect(pickBlogDomain([emptyDuplicate, real])?.id).toBe('85lu');
    expect(pickBlogDomain([real, emptyDuplicate])?.id).toBe('85lu');
  });

  it('an empty duplicate never wins even when it alone is verified', () => {
    const real = { id: 'real', published_count: 12, verified_at: null };
    const emptyVerified = { id: 'empty', published_count: 0, verified_at: '2026-06-02T00:00:00Z' };
    expect(pickBlogDomain([emptyVerified, real])?.id).toBe('real');
  });

  it('breaks a content tie by post count', () => {
    const more = { id: 'more', published_count: 20, verified_at: null };
    const fewer = { id: 'fewer', published_count: 5, verified_at: '2026-06-02T00:00:00Z' };
    expect(pickBlogDomain([fewer, more])?.id).toBe('more');
  });

  it('when both rows are empty, falls back to verified-first (newest)', () => {
    const older = { id: 'older', published_count: 0, verified_at: '2026-01-01T00:00:00Z' };
    const newer = { id: 'newer', published_count: 0, verified_at: '2026-06-01T00:00:00Z' };
    const unverified = { id: 'unverified', published_count: 0, verified_at: null };
    expect(pickBlogDomain([unverified, older, newer])?.id).toBe('newer');
    expect(pickBlogDomain([unverified, older])?.id).toBe('older');
  });

  it('uses a configured custom_blog_hostname as the final tiebreak', () => {
    const withHost = { id: 'withHost', published_count: 0, verified_at: null, custom_blog_hostname: 'blog.acme.com' };
    const withoutHost = { id: 'withoutHost', published_count: 0, verified_at: null, custom_blog_hostname: null };
    expect(pickBlogDomain([withoutHost, withHost])?.id).toBe('withHost');
  });

  it('post count outranks a custom hostname', () => {
    const populated = { id: 'populated', published_count: 3, verified_at: null, custom_blog_hostname: null };
    const emptyWithHost = { id: 'emptyWithHost', published_count: 0, verified_at: null, custom_blog_hostname: 'blog.acme.com' };
    expect(pickBlogDomain([emptyWithHost, populated])?.id).toBe('populated');
  });
});

describe('compareBlogDomain', () => {
  it('produces a stable ordering consistent with pickBlogDomain', () => {
    const rows: (DomainCandidate & { id: string })[] = [
      { id: 'empty-new', published_count: 0, verified_at: '2026-08-01T00:00:00Z' },
      { id: 'real', published_count: 34, verified_at: '2026-06-02T00:00:00Z' },
      { id: 'empty-old', published_count: 0, verified_at: '2026-01-01T00:00:00Z' },
    ];
    const sorted = [...rows].sort(compareBlogDomain).map((r) => r.id);
    expect(sorted[0]).toBe('real');
    expect(sorted[sorted.length - 1]).toBe('empty-old');
  });
});
