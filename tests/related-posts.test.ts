import { describe, it, expect } from 'vitest';
import { titleTokens, pickRelated, type RelatedCandidate } from '../lib/related-posts';

const c = (slug: string, title: string, published_at = '2026-01-01'): RelatedCandidate =>
  ({ slug, title, published_at });

describe('titleTokens', () => {
  it('drops stopwords, numbers, and short tokens', () => {
    const t = titleTokens('The 7 Best Ways to Brew Filter Coffee at Home');
    expect(t.has('brew')).toBe(true);
    expect(t.has('filter')).toBe(true);
    expect(t.has('coffee')).toBe(true);
    expect(t.has('home')).toBe(true);
    expect(t.has('the')).toBe(false);
    expect(t.has('best')).toBe(false);
    expect(t.has('7')).toBe(false);
  });

  it('keeps CJK words (splits on whitespace, not \\w)', () => {
    const t = titleTokens('원두 보관법: 신선한 커피를 위한 가이드');
    expect(t.has('원두')).toBe(true);
    expect(t.has('보관법')).toBe(true);
    expect(t.has('커피를')).toBe(true);
  });
});

describe('pickRelated', () => {
  const current = { slug: 'brew-filter-coffee', title: 'How to Brew Filter Coffee' };

  it('ranks by token overlap', () => {
    const out = pickRelated(current, [
      c('a', 'Espresso Machines Reviewed'),
      c('b', 'Filter Coffee Water Temperature'),
      c('d', 'Choosing a Coffee Grinder'),
      c('e', 'Brew Better Filter Coffee Every Morning'),
    ], 2);
    expect(out.map((x) => x.slug)).toEqual(['e', 'b']);
  });

  it('never returns the current post', () => {
    const out = pickRelated(current, [
      c('brew-filter-coffee', 'How to Brew Filter Coffee'),
      c('b', 'Filter Coffee Water Temperature'),
    ]);
    expect(out.find((x) => x.slug === 'brew-filter-coffee')).toBeUndefined();
  });

  it('falls back to most recent when nothing overlaps', () => {
    const out = pickRelated(current, [
      c('old', 'Gardening for Beginners', '2025-01-01'),
      c('new', 'Sourdough Starter Basics', '2026-03-01'),
      c('mid', 'Houseplant Care', '2025-06-01'),
    ], 2);
    expect(out.map((x) => x.slug)).toEqual(['new', 'mid']);
  });

  it('pads partial overlap matches with recent posts up to n', () => {
    const out = pickRelated(current, [
      c('match', 'Cold Brew Coffee Concentrate', '2025-02-01'),
      c('recent', 'Sourdough Starter Basics', '2026-03-01'),
      c('older', 'Houseplant Care', '2025-06-01'),
    ], 3);
    expect(out[0].slug).toBe('match');          // only overlap first
    expect(out.map((x) => x.slug)).toContain('recent');
    expect(out).toHaveLength(3);
  });

  it('handles an empty candidate list', () => {
    expect(pickRelated(current, [])).toEqual([]);
  });
});
