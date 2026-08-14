/**
 * Reading Reddit — URL building and listing parsing are pure; only `fetchListing`
 * touches the network.
 *
 * Reddit's public JSON is read-only and needs no OAuth: append `.json` to any
 * listing path. It does need an honest, identifying `User-Agent` — the default
 * Node/undici one is refused outright — and it rate-limits unauthenticated
 * callers hard, which is why `harvest` caps the number of requests rather than
 * running the full subreddit × query cross product.
 *
 * NOTHING HERE WRITES TO REDDIT. There is no send path, no comment path, no
 * OAuth. Drafts are copied out by a human. Reddit's own rules treat automated
 * unsolicited messaging as spam, and a machine that can send is a machine that
 * will eventually send something nobody read first.
 */
import type { RedditPost } from './screen';

/**
 * Where people with this problem actually post.
 *
 * Founder-side subs, not practitioner subs. r/SEO is deliberately absent: it is
 * mostly people who sell SEO, so almost every post there trips the `for_hire`
 * or `competitor` blocker and the requests are wasted.
 */
export const DEFAULT_SUBREDDITS = [
  'SaaS',
  'indiehackers',
  'SideProject',
  'microsaas',
  'startups',
  'EntrepreneurRideAlong',
  'smallbusiness',
  'juststart',
];

/**
 * Search terms, one per pain the screen knows how to read.
 *
 * Kept short on purpose — Reddit's search is a weak matcher and long natural
 * phrases return nothing. Breadth is fine because `screenPost` is the actual
 * filter; the query only has to put plausible posts in front of it.
 */
export const DEFAULT_QUERIES = [
  'no traffic',
  'no time to write',
  'stopped blogging',
  'is seo worth it',
  'content marketing',
  'distribution',
];

export type SearchOpts = {
  query: string;
  /** Omit to search all of Reddit. */
  subreddit?: string;
  sort?: 'new' | 'relevance' | 'top';
  /** Reddit's `t` window. */
  time?: 'day' | 'week' | 'month' | 'year' | 'all';
  limit?: number;
};

/** Pure — the exact URL `fetchListing` will request. Tested, so it can't drift. */
export function redditSearchUrl(opts: SearchOpts): string {
  const base = opts.subreddit
    ? `https://www.reddit.com/r/${encodeURIComponent(opts.subreddit)}/search.json`
    : 'https://www.reddit.com/search.json';
  const p = new URLSearchParams({
    q: opts.query,
    sort: opts.sort ?? 'new',
    t: opts.time ?? 'week',
    limit: String(Math.min(100, Math.max(1, opts.limit ?? 50))),
    // Ask for self posts where possible: a link post has no body, and a body is
    // what both the screen and the DM's first line are built out of.
    type: 'link',
  });
  if (opts.subreddit) p.set('restrict_sr', '1');
  return `${base}?${p.toString()}`;
}

/**
 * Reddit's listing JSON → our shape, dropping anything unusable.
 *
 * Defensive throughout: this is third-party JSON whose shape changes without
 * notice, and a scan that throws on one malformed child returns nothing at all.
 * A post missing an id, an author or a title is skipped, not repaired.
 */
export function parseListing(json: unknown): RedditPost[] {
  const children = (json as any)?.data?.children;
  if (!Array.isArray(children)) return [];

  const out: RedditPost[] = [];
  for (const child of children) {
    const d = child?.data;
    if (!d || typeof d !== 'object') continue;
    if (d.stickied === true || d.pinned === true) continue; // mod posts, never prospects
    if (typeof d.id !== 'string' || !d.id) continue;
    if (typeof d.title !== 'string' || !d.title.trim()) continue;

    const permalink =
      typeof d.permalink === 'string' && d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : typeof d.url === 'string'
          ? d.url
          : `https://www.reddit.com/comments/${d.id}`;

    out.push({
      id: String(d.id),
      subreddit: String(d.subreddit ?? ''),
      author: String(d.author ?? ''),
      title: String(d.title),
      // Removed bodies come back as these literals rather than as empty.
      selftext: normalizeBody(d.selftext),
      permalink,
      createdUtc: Number.isFinite(d.created_utc) ? Number(d.created_utc) : 0,
      score: Number.isFinite(d.score) ? Number(d.score) : 0,
      numComments: Number.isFinite(d.num_comments) ? Number(d.num_comments) : 0,
      flair: typeof d.link_flair_text === 'string' ? d.link_flair_text : null,
    });
  }
  return out;
}

function normalizeBody(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  return /^\[(?:removed|deleted)\]$/i.test(s.trim()) ? '' : s;
}

/**
 * Reddit refuses anonymous-looking clients. Set `GROVE_REDDIT_USER_AGENT` to
 * something with a real contact in it — that is what the API terms ask for, and
 * it is also what gets you unblocked rather than rate-limited into silence.
 */
function userAgent(): string {
  return process.env.GROVE_REDDIT_USER_AGENT ?? 'web:grove-outreach:0.1 (by /u/grove-seo)';
}

export class RedditFetchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'RedditFetchError';
  }
}

/** One listing request. Throws `RedditFetchError` with something actionable. */
export async function fetchListing(url: string, timeoutMs = 10_000): Promise<RedditPost[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': userAgent(), accept: 'application/json' },
      signal: ctl.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      // 403 from a datacenter IP is the common one and it is NOT a bug in the
      // query — Reddit blocks cloud ranges. Say so, because the alternative is
      // an afternoon spent debugging a perfectly good URL.
      const hint =
        res.status === 403
          ? ' — Reddit blocks many datacenter IPs and unidentified clients; set GROVE_REDDIT_USER_AGENT to a real contact string, or run the scan from somewhere else.'
          : res.status === 429
            ? ' — rate limited; lower maxRequests or wait a minute.'
            : '';
      throw new RedditFetchError(res.status, `Reddit returned ${res.status}${hint}`);
    }
    return parseListing(await res.json());
  } catch (err) {
    if (err instanceof RedditFetchError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new RedditFetchError(408, `Reddit did not answer within ${timeoutMs / 1000}s`);
    }
    throw new RedditFetchError(0, `Could not reach Reddit: ${(err as Error)?.message ?? 'unknown error'}`);
  }
}

export type HarvestResult = {
  posts: RedditPost[];
  /** URLs that answered, for the run log. */
  queried: string[];
  /** Per-request failures. A partial harvest is still worth screening. */
  errors: string[];
};

/**
 * Run the queries and return every distinct post found.
 *
 * The cross product of the defaults is 48 requests, which unauthenticated
 * Reddit will not serve. `maxRequests` caps it and the loop interleaves
 * queries across subreddits so a cap doesn't mean "the first subreddit only".
 * Failures are collected rather than thrown: one 429 in the middle should not
 * discard the twenty listings that already came back.
 */
export async function harvest(
  opts: {
    subreddits?: string[];
    queries?: string[];
    time?: SearchOpts['time'];
    limit?: number;
    maxRequests?: number;
    /** Injectable for tests — defaults to the real fetch. */
    fetcher?: (url: string) => Promise<RedditPost[]>;
  } = {},
): Promise<HarvestResult> {
  const subreddits = opts.subreddits?.length ? opts.subreddits : DEFAULT_SUBREDDITS;
  const queries = opts.queries?.length ? opts.queries : DEFAULT_QUERIES;
  const maxRequests = Math.max(1, opts.maxRequests ?? 12);
  const fetcher = opts.fetcher ?? ((url: string) => fetchListing(url));

  // Query-major order: every subreddit sees query 0 before any sees query 1.
  const urls: string[] = [];
  for (const query of queries) {
    for (const subreddit of subreddits) {
      urls.push(redditSearchUrl({ query, subreddit, time: opts.time ?? 'week', limit: opts.limit ?? 50 }));
    }
  }

  const seen = new Set<string>();
  const posts: RedditPost[] = [];
  const queried: string[] = [];
  const errors: string[] = [];

  // Sequential on purpose. Parallel requests are exactly what trips Reddit's
  // unauthenticated rate limit, and the whole scan is a background chore.
  for (const url of urls.slice(0, maxRequests)) {
    try {
      const batch = await fetcher(url);
      queried.push(url);
      for (const p of batch) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        posts.push(p);
      }
    } catch (err) {
      errors.push(`${url.replace('https://www.reddit.com', '')}: ${(err as Error)?.message ?? 'failed'}`);
    }
  }

  return { posts, queried, errors };
}
