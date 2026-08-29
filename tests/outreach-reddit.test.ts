/**
 * Reading Reddit: the URL we build and the JSON we trust.
 *
 * `parseListing` is defensive on purpose — it eats third-party JSON whose shape
 * changes without warning, and a scan that throws on one malformed child
 * returns nothing at all. These tests pin that a bad row is skipped rather than
 * repaired or fatal.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  redditSearchUrl, parseListing, harvest, DEFAULT_SUBREDDITS,
  hostFor, hasRedditAuth, resetRedditAuth, fetchListing,
} from '../lib/outreach/reddit';
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

/**
 * App-only OAuth: the difference between a scan that works from Vercel and one
 * that 403s. Reddit serves anonymous JSON to laptops and refuses most cloud IPs,
 * so the host we read from has to follow whether we hold credentials.
 */
describe('reading as an identified app', () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
    resetRedditAuth();
  });

  function withCreds() {
    process.env.GROVE_REDDIT_CLIENT_ID = 'id123';
    process.env.GROVE_REDDIT_CLIENT_SECRET = 'secret456';
  }
  function withoutCreds() {
    delete process.env.GROVE_REDDIT_CLIENT_ID;
    delete process.env.GROVE_REDDIT_CLIENT_SECRET;
  }

  it('needs BOTH halves of the credential before it counts as authed', () => {
    withoutCreds();
    expect(hasRedditAuth()).toBe(false);
    process.env.GROVE_REDDIT_CLIENT_ID = 'id123';
    expect(hasRedditAuth()).toBe(false); // half a credential is not a credential
    process.env.GROVE_REDDIT_CLIENT_SECRET = 'secret456';
    expect(hasRedditAuth()).toBe(true);
  });

  it('reads from oauth.reddit.com when authed and www when not, path untouched', () => {
    const url = redditSearchUrl({ query: 'no traffic', subreddit: 'SaaS' });
    const anon = new URL(hostFor(url, false));
    const authed = new URL(hostFor(url, true));
    expect(anon.hostname).toBe('www.reddit.com');
    expect(authed.hostname).toBe('oauth.reddit.com');
    // Only the host may change — a rewritten query is a silently different scan.
    expect(authed.pathname).toBe(anon.pathname);
    expect(authed.search).toBe(anon.search);
  });

  it('sends a bearer token, once, across a whole scan', async () => {
    withCreds();
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      const url = String(input);
      calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      if (url.includes('/api/v1/access_token')) {
        return new Response(JSON.stringify({ access_token: 'tok_abc', expires_in: 86_400 }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    }) as typeof fetch;

    try {
      const u = redditSearchUrl({ query: 'a', subreddit: 'SaaS' });
      await fetchListing(u);
      await fetchListing(u);

      const tokenCalls = calls.filter((c) => c.url.includes('/api/v1/access_token'));
      const listingCalls = calls.filter((c) => !c.url.includes('/api/v1/access_token'));
      // Cached: two listings, one token round-trip.
      expect(tokenCalls).toHaveLength(1);
      expect(listingCalls).toHaveLength(2);
      expect(tokenCalls[0].headers.authorization).toMatch(/^Basic /);
      for (const c of listingCalls) {
        expect(c.url).toContain('oauth.reddit.com');
        expect(c.headers.authorization).toBe('Bearer tok_abc');
        expect(c.headers['user-agent']).toBeTruthy();
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('never sends an Authorization header when there are no credentials', async () => {
    withoutCreds();
    const seen: Record<string, string>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init: any = {}) => {
      seen.push((init.headers ?? {}) as Record<string, string>);
      expect(String(input)).toContain('www.reddit.com');
      return new Response(JSON.stringify({ data: { children: [] } }), { status: 200 });
    }) as typeof fetch;

    try {
      await fetchListing(redditSearchUrl({ query: 'a', subreddit: 'SaaS' }));
      expect(seen[0].authorization).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('tells you to get credentials on an anonymous 403, not to fiddle with the UA', async () => {
    withoutCreds();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('blocked', { status: 403 })) as typeof fetch;
    try {
      await expect(fetchListing(redditSearchUrl({ query: 'a' }))).rejects.toThrow(
        /GROVE_REDDIT_CLIENT_ID/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('gives different advice for a 403 that happened WITH a valid token', async () => {
    withCreds();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) =>
      String(input).includes('/api/v1/access_token')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
        : new Response('nope', { status: 403 })) as typeof fetch;
    try {
      // Suggesting "set credentials" to someone who already has them is the
      // wrong-answer failure this branch exists to prevent.
      const err = await fetchListing(redditSearchUrl({ query: 'a' })).catch((e) => e as Error);
      expect(err.message).toMatch(/token was accepted/);
      expect(err.message).not.toMatch(/GROVE_REDDIT_CLIENT_ID/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('names bad credentials as bad credentials, not as a network problem', async () => {
    withCreds();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('unauthorized', { status: 401 })) as typeof fetch;
    try {
      await expect(fetchListing(redditSearchUrl({ query: 'a' }))).rejects.toThrow(
        /rejected the app credentials/,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
