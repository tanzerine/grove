import { describe, it, expect } from 'vitest';
import { weightedPosition, nearWinners, summarize, type MetricRow } from '../lib/search-console/insights';

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
});
