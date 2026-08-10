import { describe, it, expect } from 'vitest';
import { weightedPosition, nearWinners, summarize, articleRows, type MetricRow, type ArticleInfo } from '../lib/search-console/insights';

const page = (key: string, impressions: number, position: number, clicks = 0, post_id: string | null = null): MetricRow =>
  ({ key, impressions, position, clicks, post_id });

describe('weightedPosition', () => {
  it('weights by impressions, not a flat average', () => {
    // 1000 impressions at pos 10, 10 impressions at pos 1 → should sit near 10
    const pos = weightedPosition([page('a', 1000, 10), page('b', 10, 1)]);
    expect(pos).toBeGreaterThan(9.5);
    expect(pos).toBeLessThanOrEqual(10);
  });
  it('ignores rows with no impressions or no position', () => {
    expect(weightedPosition([page('a', 0, 5), page('b', 100, 0)])).toBe(0);
    expect(weightedPosition([])).toBe(0);
  });
});

describe('nearWinners', () => {
  const pages = [
    page('p-top', 500, 3),       // already page 1 — excluded
    page('p-12', 300, 12, 5, 'post-12'),
    page('p-9', 80, 9, 1, 'post-9'),
    page('p-25', 999, 25),       // too deep — excluded
    page('p-lowimp', 2, 11),     // below impression floor — excluded
  ];
  it('keeps only page-2 pages with enough impressions, sorted by opportunity', () => {
    const w = nearWinners(pages);
    expect(w.map((x) => x.key)).toEqual(['p-12', 'p-9']);
    expect(w[0].post_id).toBe('post-12');     // carries the mapped post
  });
  it('respects custom bands and limit', () => {
    const w = nearWinners(pages, { minPos: 1, maxPos: 30, minImpressions: 1, limit: 2 });
    expect(w).toHaveLength(2);
    expect(w[0].impressions).toBeGreaterThanOrEqual(w[1].impressions); // sorted desc
  });

  // The queries are what make "don't compete with this page" enforceable — a
  // bare URL path leaves the planner guessing what the page is even about.
  it('attaches the queries each page owns, biggest first', () => {
    const w = nearWinners(pages, {
      pageQueries: [
        { page: 'p-12', query: 'small demand', impressions: 10, position: 14 },
        { page: 'p-12', query: 'big demand', impressions: 200, position: 11.44 },
        { page: 'p-9', query: 'other page', impressions: 50, position: 9 },
      ],
    });
    expect(w[0].queries.map((q) => q.query)).toEqual(['big demand', 'small demand']);
    expect(w[0].queries[0].position).toBe(11.4);        // rounded to 1dp
    expect(w[1].queries.map((q) => q.query)).toEqual(['other page']);
  });

  it('caps queries per page so one page cannot flood the prompt', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      page: 'p-12', query: `q${i}`, impressions: 100 - i, position: 12,
    }));
    expect(nearWinners(pages, { pageQueries: many })[0].queries).toHaveLength(4);
  });

  it('joins across a trailing-slash mismatch between the two snapshots', () => {
    const w = nearWinners([page('https://a.com/x', 300, 12, 5, 'post-x')], {
      pageQueries: [{ page: 'https://a.com/x/', query: 'q', impressions: 5, position: 12 }],
    });
    expect(w[0].queries.map((q) => q.query)).toEqual(['q']);
  });

  it('gives every winner an empty query list when no snapshot exists', () => {
    // Domains whose last sync predates migration 0032 have no page+query rows.
    for (const w of nearWinners(pages)) expect(w.queries).toEqual([]);
  });
});

describe('summarize', () => {
  it('rolls up totals, ctr, query count, and near-winners', () => {
    const pages = [page('p-12', 300, 12, 6, 'post-12'), page('p-top', 700, 2, 40)];
    const queries = [page('best widgets', 600, 4, 30), page('cheap widgets', 50, 18, 1), page('zero', 0, 0)];
    const v = summarize(pages, queries);
    expect(v.impressions).toBe(1000);
    expect(v.clicks).toBe(46);
    expect(v.ctr).toBe(0.046);
    expect(v.queryCount).toBe(2);                 // the zero-impression query is dropped
    expect(v.topQueries[0].query).toBe('best widgets'); // sorted by impressions
    expect(v.nearWinners.map((w) => w.key)).toEqual(['p-12']);
  });

  it('threads the page+query snapshot down to the near-winners', () => {
    const v = summarize(
      [page('p-12', 300, 12, 6, 'post-12')],
      [page('best widgets', 600, 4, 30)],
      [{ page: 'p-12', query: 'widget sizing', impressions: 90, position: 11 }],
    );
    expect(v.nearWinners[0].queries.map((q) => q.query)).toEqual(['widget sizing']);
  });
});

describe('articleRows', () => {
  const art = (id: string, title: string | null, slug: string | null, reads: number | null = 0): ArticleInfo =>
    ({ id, title, slug, reads });

  it('returns one row per published article, even ones Google never surfaced', () => {
    const posts = [art('a', 'Alpha', 'alpha', 12), art('b', 'Beta', 'beta', 3)];
    const pages = [page('https://x.com/alpha', 100, 8, 4, 'a')]; // only alpha ranks
    const rows = articleRows(pages, posts);
    expect(rows).toHaveLength(2);
    const beta = rows.find((r) => r.postId === 'b')!;
    expect(beta.clicks).toBe(0);
    expect(beta.impressions).toBe(0);
    expect(beta.views).toBe(3);           // views come from reads, independent of GSC
    expect(beta.position).toBe(0);
  });

  it('folds multiple URLs for the same post (mirror + own domain) into one row', () => {
    const posts = [art('a', 'Alpha', 'alpha', 50)];
    const pages = [
      page('https://grove.so/b/demo/alpha', 200, 10, 2, 'a'),
      page('https://acme.com/blog/alpha', 300, 5, 8, 'a'),
    ];
    const rows = articleRows(pages, posts);
    expect(rows).toHaveLength(1);
    expect(rows[0].clicks).toBe(10);        // 2 + 8 summed
    expect(rows[0].impressions).toBe(500);  // 200 + 300 summed
    expect(rows[0].views).toBe(50);
    // impression-weighted position: (10*200 + 5*300)/500 = 7
    expect(rows[0].position).toBe(7);
    expect(rows[0].ctr).toBe(0.02);         // 10 / 500
  });

  it('sorts by clicks, then impressions, then views (busiest first)', () => {
    const posts = [
      art('a', 'A', 'a', 5),
      art('b', 'B', 'b', 99),   // most views but no clicks
      art('c', 'C', 'c', 1),
    ];
    const pages = [
      page('https://x.com/a', 10, 6, 3, 'a'),   // 3 clicks
      page('https://x.com/c', 10, 6, 9, 'c'),   // 9 clicks
    ];
    const rows = articleRows(pages, posts);
    expect(rows.map((r) => r.postId)).toEqual(['c', 'a', 'b']);
  });

  it('falls back to the article slug path when no GSC row exists', () => {
    const rows = articleRows([], [art('a', 'Alpha', 'alpha', 0)]);
    expect(rows[0].path).toBe('/alpha');
    expect(rows[0].title).toBe('Alpha');
  });

  it('carries the publish date through, and reads null when the post has none', () => {
    const dated = { ...art('a', 'Alpha', 'alpha', 0), published_at: '2026-08-04T09:30:00Z' };
    const rows = articleRows([], [dated, art('b', 'Beta', 'beta', 0)]);
    expect(rows.find((r) => r.postId === 'a')!.publishedAt).toBe('2026-08-04T09:30:00Z');
    expect(rows.find((r) => r.postId === 'b')!.publishedAt).toBeNull();
  });
});
