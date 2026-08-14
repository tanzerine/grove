/**
 * Reading Reddit: the URL we build and the JSON we trust.
 *
 * `parseListing` is defensive on purpose — it eats third-party JSON whose shape
 * changes without warning, and a scan that throws on one malformed child
 * returns nothing at all. These tests pin that a bad row is skipped rather than
 * repaired or fatal.
 */
import { describe, it, expect } from 'vitest';
import { redditSearchUrl, parseListing, harvest, DEFAULT_SUBREDDITS } from '../lib/outreach/reddit';
import type { RedditPost } from '../lib/outreach/screen';

describe('redditSearchUrl', () => {
  it('restricts to the subreddit when one is given', () => {
    const u = new URL(redditSearchUrl({ query: 'no traffic', subreddit: 'SaaS' }));
    expect(u.pathname).toBe('/r/SaaS/search.json');
    expect(u.searchParams.get('restrict_sr')).toBe('1');
    expect(u.searchParams.get('q')).toBe('no traffic');
    expect(u.searchParams.get('sort')).toBe('new');
    expect(u.searchParams.get('t')).toBe('week');
  });

  it('searches all of Reddit without one, and never sets restrict_sr', () => {
    const u = new URL(redditSearchUrl({ query: 'seo' }));
    expect(u.pathname).toBe('/search.json');
    expect(u.searchParams.get('restrict_sr')).toBeNull();
  });

  it('clamps the limit to what Reddit will actually serve', () => {
    expect(new URL(redditSearchUrl({ query: 'x', limit: 5000 })).searchParams.get('limit')).toBe('100');
    expect(new URL(redditSearchUrl({ query: 'x', limit: 0 })).searchParams.get('limit')).toBe('1');
  });

  it('escapes a subreddit name rather than pasting it into the path', () => {
    expect(redditSearchUrl({ query: 'x', subreddit: 'a/../b' })).toContain('/r/a%2F..%2Fb/');
  });
});

describe('parseListing', () => {
  const listing = (children: unknown[]) => ({ kind: 'Listing', data: { children } });
  const child = (data: Record<string, unknown>) => ({ kind: 't3', data });

  it('maps the wire shape onto ours', () => {
    const [p] = parseListing(listing([
      child({
        id: 'abc', subreddit: 'SaaS', author: 'founder1', title: 'no traffic',
        selftext: 'my site gets nothing', permalink: '/r/SaaS/comments/abc/no_traffic/',
        created_utc: 1_770_000_000, score: 42, num_comments: 7, link_flair_text: 'Question',
      }),
    ]));
    expect(p).toEqual<RedditPost>({
      id: 'abc', subreddit: 'SaaS', author: 'founder1', title: 'no traffic',
      selftext: 'my site gets nothing',
      permalink: 'https://www.reddit.com/r/SaaS/comments/abc/no_traffic/',
      createdUtc: 1_770_000_000, score: 42, numComments: 7, flair: 'Question',
    });
  });

  it('skips stickied mod posts, which are never prospects', () => {
    expect(parseListing(listing([child({ id: 'a', title: 'Weekly thread', stickied: true })]))).toHaveLength(0);
  });

  it('skips a child with no id or no title rather than inventing one', () => {
    const out = parseListing(listing([
      child({ title: 'no id here' }),
      child({ id: 'b', title: '   ' }),
      child({ id: 'c', title: 'fine' }),
    ]));
    expect(out.map((p) => p.id)).toEqual(['c']);
  });

  it('treats a removed body as empty, not as the literal "[removed]"', () => {
    const [p] = parseListing(listing([child({ id: 'a', title: 't', selftext: '[removed]' })]));
    expect(p.selftext).toBe('');
  });

  it('survives junk instead of throwing away the whole scan', () => {
    expect(parseListing(null)).toEqual([]);
    expect(parseListing({})).toEqual([]);
    expect(parseListing({ data: { children: 'nope' } })).toEqual([]);
    expect(parseListing(listing([null, 42, child({ id: 'a', title: 'ok' })]))).toHaveLength(1);
  });

  it('defaults the numbers rather than emitting NaN into the score', () => {
    const [p] = parseListing(listing([child({ id: 'a', title: 't', created_utc: 'soon', score: null })]));
    expect(p.createdUtc).toBe(0);
    expect(p.score).toBe(0);
    expect(p.numComments).toBe(0);
  });
});

describe('harvest', () => {
  const fakePost = (id: string): RedditPost => ({
    id, subreddit: 'SaaS', author: `u${id}`, title: id, selftext: '',
    permalink: `https://www.reddit.com/${id}`, createdUtc: 0, score: 0, numComments: 0,
  });

  it('caps the number of requests — the full cross product is more than Reddit serves', async () => {
    const urls: string[] = [];
    await harvest({
      queries: ['a', 'b', 'c'], subreddits: ['x', 'y', 'z'], maxRequests: 4,
      fetcher: async (u) => { urls.push(u); return []; },
    });
    expect(urls).toHaveLength(4);
  });

  it('interleaves queries across subreddits, so a cap is not "one subreddit only"', async () => {
    const urls: string[] = [];
    await harvest({
      queries: ['a', 'b'], subreddits: ['x', 'y', 'z'], maxRequests: 3,
      fetcher: async (u) => { urls.push(u); return []; },
    });
    // First three requests are query "a" against all three subreddits.
    expect(urls.every((u) => u.includes('q=a'))).toBe(true);
    expect(urls.map((u) => u.match(/\/r\/([^/]+)\//)?.[1])).toEqual(['x', 'y', 'z']);
  });

  it('deduplicates a post that answers to several queries', async () => {
    const { posts } = await harvest({
      queries: ['a', 'b'], subreddits: ['x'], fetcher: async () => [fakePost('same')],
    });
    expect(posts).toHaveLength(1);
  });

  it('keeps what came back when one request fails', async () => {
    let n = 0;
    const { posts, errors, queried } = await harvest({
      queries: ['a', 'b'], subreddits: ['x'],
      fetcher: async () => {
        n++;
        if (n === 1) throw new Error('429 rate limited');
        return [fakePost('kept')];
      },
    });
    expect(posts.map((p) => p.id)).toEqual(['kept']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('429');
    expect(queried).toHaveLength(1);
  });

  it('defaults to founder subreddits, not practitioner ones', () => {
    // r/SEO is mostly people who sell SEO — every post there trips a blocker.
    expect(DEFAULT_SUBREDDITS).not.toContain('SEO');
    expect(DEFAULT_SUBREDDITS).toContain('SaaS');
  });
});
