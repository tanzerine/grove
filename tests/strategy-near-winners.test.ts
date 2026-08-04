import { describe, it, expect } from 'vitest';
import { digestReport } from '../lib/strategy/build';
import type { MonthlyReport } from '../lib/strategy/review';

/**
 * The near-winner section of the planner digest is a behavioural guard, not
 * decoration. Grove's only output is new articles, so telling the planner to
 * "dedicate slots to sharper/expanded angles on these exact topics" — which is
 * what it used to say — asked for a second URL aimed at a query one of our own
 * page-2 URLs already owned. Two of our pages then split the signal and neither
 * reaches the top 10. These assert the instruction that replaced it.
 */

const report = (search_console: MonthlyReport['search_console']): MonthlyReport => ({
  month: '2026-07',
  posts_count: 4,
  totals: {
    views: 100, unique_sessions: 80, median_dwell_sec: 45, scroll_completion_rate: 0.4,
    outbound_to_product_rate: 0.1, conversions: 2, organic_share: 0.6,
  },
  per_pillar: {},
  per_intent: {} as MonthlyReport['per_intent'],
  top_posts: [],
  bottom_posts: [],
  top_referrers: [],
  top_queries: [],
  search_console,
});

const visibility = (overrides: Partial<NonNullable<MonthlyReport['search_console']>> = {}) => ({
  impressions: 1000, clicks: 40, ctr: 0.04, avgPosition: 12.5, queryCount: 6,
  topQueries: [
    { query: 'widget sizing guide', impressions: 400, clicks: 20, position: 11 },
    { query: 'unrelated demand', impressions: 200, clicks: 5, position: 30 },
  ],
  nearWinners: [
    {
      key: 'https://acme.com/b/demo/widget-sizing',
      post_id: 'post-1', impressions: 400, clicks: 20, position: 11.4,
      queries: [{ query: 'widget sizing guide', impressions: 400, position: 11 }],
    },
  ],
  ...overrides,
});

describe('digestReport near-winner guard', () => {
  it('marks the queries a near-winner owns as taken, and names the page', () => {
    const out = digestReport(report(visibility()));
    expect(out).toContain('TAKEN');
    expect(out).toContain('owns: "widget sizing guide"');
    // path only — the origin is noise the planner does not need
    expect(out).toContain('"/b/demo/widget-sizing"');
    expect(out).not.toContain('https://acme.com/b/demo/widget-sizing');
  });

  it('no longer asks for a sharper or expanded retread of those pages', () => {
    const out = digestReport(report(visibility()));
    expect(out).not.toMatch(/dedicate slots to sharper\/expanded angles/i);
    expect(out).toMatch(/must not be competed with/i);
  });

  it('still allows the legitimate move — a different query that links back', () => {
    const out = digestReport(report(visibility()));
    expect(out).toMatch(/NEXT question/i);
    expect(out).toMatch(/DIFFERENT query/);
  });

  // The two blocks would otherwise disagree on the same string: one asking the
  // planner to cover a query, the other forbidding it.
  it('withholds an owned query from the "cover these" list', () => {
    const out = digestReport(report(visibility()));
    const coverLine = out.split('\n').find((l) => l.startsWith('GSC QUERIES YOU ALREADY RANK FOR'))!;
    expect(coverLine).toContain('unrelated demand');
    expect(coverLine).not.toContain('widget sizing guide');
  });

  it('matches owned queries case-insensitively', () => {
    const out = digestReport(report(visibility({
      topQueries: [{ query: 'Widget Sizing Guide', impressions: 400, clicks: 20, position: 11 }],
    })));
    const coverLine = out.split('\n').find((l) => l.startsWith('GSC QUERIES YOU ALREADY RANK FOR'))!;
    expect(coverLine).toContain('(none)');
  });

  it('still lists a near-winner that has no query data yet', () => {
    // Domains synced before migration 0032 have no page+query rows; the page is
    // still worth protecting, just with a weaker identifier.
    const out = digestReport(report(visibility({
      nearWinners: [{
        key: 'https://acme.com/b/demo/legacy', post_id: 'post-2',
        impressions: 300, clicks: 9, position: 15, queries: [],
      }],
    })));
    expect(out).toContain('"/b/demo/legacy"');
    expect(out).not.toContain('owns:');
  });

  it('omits the whole section when GSC has no impressions', () => {
    expect(digestReport(report(visibility({ impressions: 0 })))).not.toContain('NEAR-WINNERS');
    expect(digestReport(report(null))).not.toContain('NEAR-WINNERS');
  });
});
