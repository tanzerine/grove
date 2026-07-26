import { describe, it, expect } from 'vitest';
import { highlight, normalize, orFilter, queryTokens, searchPosts, type SearchablePost } from '../lib/post-search';

const p = (over: Partial<SearchablePost> & { id: string }): SearchablePost => ({
  title: null, topic: null, slug: null, meta_description: null,
  status: 'published', published_at: '2026-01-01T00:00:00Z',
  scheduled_at: null, created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('normalize / queryTokens', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normalize('How to Brew — Filter/Coffee!')).toBe('how to brew filter coffee');
  });

  it('keeps CJK words (splits on whitespace, not \\w)', () => {
    expect(queryTokens('원두 보관법: 신선한')).toEqual(['원두', '보관법', '신선한']);
  });

  it('is empty for blank input', () => {
    expect(queryTokens('   ')).toEqual([]);
    expect(normalize(null)).toBe('');
  });
});

describe('searchPosts', () => {
  const posts = [
    p({ id: 'a', title: 'How to Brew Filter Coffee at Home', slug: 'brew-filter-coffee' }),
    p({ id: 'b', title: 'Espresso Machines Reviewed', slug: 'espresso-machines' }),
    p({ id: 'c', title: 'Water Temperature Guide', topic: 'filter coffee water temp', slug: 'water-temperature' }),
    p({ id: 'd', title: 'Choosing a Grinder', meta_description: 'The grinder matters more than the coffee machine.' }),
  ];

  it('needs at least two characters', () => {
    expect(searchPosts(posts, 'c')).toEqual([]);
    expect(searchPosts(posts, '')).toEqual([]);
    expect(searchPosts(posts, '  ')).toEqual([]);
  });

  it('matches on title, topic and meta description', () => {
    expect(searchPosts(posts, 'espresso').map((x) => x.id)).toEqual(['b']);
    expect(searchPosts(posts, 'water temp').map((x) => x.id)).toEqual(['c']);
    expect(searchPosts(posts, 'grinder matters').map((x) => x.id)).toEqual(['d']);
  });

  it('ranks a title match above a topic or meta match', () => {
    expect(searchPosts(posts, 'coffee').map((x) => x.id)).toEqual(['a', 'c', 'd']);
  });

  it('requires every token to match somewhere (AND, not OR)', () => {
    // "espresso" and "grinder" each match a different post — neither has both.
    expect(searchPosts(posts, 'espresso grinder')).toEqual([]);
  });

  it('matches prefixes so results appear while typing', () => {
    expect(searchPosts(posts, 'espr').map((x) => x.id)).toEqual(['b']);
    expect(searchPosts(posts, 'brew fil').map((x) => x.id)).toEqual(['a']);
  });

  it('prefers the whole phrase over the same words scattered', () => {
    const scattered = p({ id: 'x', title: 'Filter Basics and Coffee Myths' });
    const phrase = p({ id: 'y', title: 'Filter Coffee, Explained' });
    expect(searchPosts([scattered, phrase], 'filter coffee').map((x) => x.id)).toEqual(['y', 'x']);
  });

  it('breaks score ties with recency', () => {
    const old = p({ id: 'old', title: 'Coffee Notes', published_at: '2025-01-01T00:00:00Z' });
    const recent = p({ id: 'new', title: 'Coffee Notes', published_at: '2026-06-01T00:00:00Z' });
    expect(searchPosts([old, recent], 'coffee notes').map((x) => x.id)).toEqual(['new', 'old']);
  });

  it('falls back to scheduled/created date when nothing is published', () => {
    const draft = p({ id: 'draft', title: 'Coffee Draft', status: 'review', published_at: null, created_at: '2026-06-02T00:00:00Z' });
    const live = p({ id: 'live', title: 'Coffee Draft', published_at: '2026-06-01T00:00:00Z' });
    expect(searchPosts([draft, live], 'coffee draft').map((x) => x.id)).toEqual(['draft', 'live']);
  });

  it('finds drafts by their topic before they ever get a title', () => {
    const queued = p({ id: 'q', title: null, topic: 'cold brew ratios', status: 'queued', published_at: null });
    expect(searchPosts([queued], 'cold brew').map((x) => x.id)).toEqual(['q']);
  });

  it('searches Korean titles', () => {
    const ko = [
      p({ id: 'k1', title: '원두 보관법: 신선한 커피를 위한 가이드' }),
      p({ id: 'k2', title: '에스프레소 머신 고르기' }),
    ];
    expect(searchPosts(ko, '보관').map((x) => x.id)).toEqual(['k1']);
    expect(searchPosts(ko, '머신').map((x) => x.id)).toEqual(['k2']);
  });

  it('honours the limit', () => {
    expect(searchPosts(posts, 'coffee', 2)).toHaveLength(2);
    expect(searchPosts(posts, 'coffee')).toHaveLength(3);
  });
});

describe('orFilter', () => {
  it('unions every field for every token', () => {
    expect(orFilter(['brew'])).toBe(
      'title.ilike.%brew%,topic.ilike.%brew%,slug.ilike.%brew%,meta_description.ilike.%brew%');
    expect(orFilter(['brew', 'coffee']).split(',')).toHaveLength(8);
  });

  it('strips characters that would break out of the PostgREST filter', () => {
    const f = orFilter(["a,b)c(d'e\"f\\g"]);
    expect(f).toBe('title.ilike.%abcdefg%,topic.ilike.%abcdefg%,slug.ilike.%abcdefg%,meta_description.ilike.%abcdefg%');
  });

  it('strips ilike wildcards so they are searched literally, not expanded', () => {
    expect(orFilter(['%_*'])).toBe('');
    expect(orFilter(['50%'])).toContain('title.ilike.%50%');
  });

  it('is empty when nothing usable is left', () => {
    expect(orFilter([])).toBe('');
    expect(orFilter(['', '()'])).toBe('');
  });

  it('caps how many tokens reach the query', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(orFilter(many).split(',')).toHaveLength(6 * 4);
  });
});

describe('highlight', () => {
  it('splits the text around every match', () => {
    expect(highlight('Filter Coffee Guide', 'coffee')).toEqual([
      { text: 'Filter ', hit: false },
      { text: 'Coffee', hit: true },
      { text: ' Guide', hit: false },
    ]);
  });

  it('merges overlapping and adjacent matches', () => {
    expect(highlight('Coffee', 'cof coffee')).toEqual([{ text: 'Coffee', hit: true }]);
  });

  it('returns the text untouched when nothing matches', () => {
    expect(highlight('Filter Coffee', 'espresso')).toEqual([{ text: 'Filter Coffee', hit: false }]);
    expect(highlight('Filter Coffee', '')).toEqual([{ text: 'Filter Coffee', hit: false }]);
  });
});
