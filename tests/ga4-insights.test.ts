import { describe, it, expect } from 'vitest';
import {
  parseTotals, parsePages, avgEngagement, formatDuration, GA_METRICS,
} from '../lib/ga4/insights';
import type { GaRunReportResponse } from '../lib/ga4/client';

// Build a runReport response with our four metrics in an ARBITRARY order to
// prove parsing keys on header name, not column position.
function resp(
  rows: { title?: string; views: number; users: number; engagementSec: number; events: number }[],
  order: readonly string[] = GA_METRICS,
): GaRunReportResponse {
  const val: Record<string, (r: typeof rows[number]) => number> = {
    screenPageViews: (r) => r.views,
    activeUsers: (r) => r.users,
    userEngagementDuration: (r) => r.engagementSec,
    eventCount: (r) => r.events,
  };
  return {
    metricHeaders: order.map((name) => ({ name })),
    rows: rows.map((r) => ({
      dimensionValues: r.title !== undefined ? [{ value: r.title }] : undefined,
      metricValues: order.map((name) => ({ value: String(val[name](r)) })),
    })),
  };
}

describe('avgEngagement', () => {
  it('is engagement seconds per active user', () => {
    expect(avgEngagement(1028, 5)).toBeCloseTo(205.6); // matches the GA export
  });
  it('guards divide-by-zero', () => {
    expect(avgEngagement(500, 0)).toBe(0);
  });
});

describe('parseTotals', () => {
  it('reads a single totals row regardless of metric order', () => {
    const shuffled = ['eventCount', 'screenPageViews', 'userEngagementDuration', 'activeUsers'];
    const t = parseTotals(resp([{ views: 237, users: 123, engagementSec: 2327, events: 656 }], shuffled));
    expect(t.views).toBe(237);
    expect(t.activeUsers).toBe(123);
    expect(t.events).toBe(656);
    expect(t.avgEngagementSec).toBeCloseTo(2327 / 123);
  });
  it('sums views/events but takes max activeUsers across dimensioned rows', () => {
    const t = parseTotals(resp([
      { title: 'Home', views: 237, users: 123, engagementSec: 2000, events: 656 },
      { title: 'Blog', views: 67, users: 5, engagementSec: 1028, events: 117 },
    ]));
    expect(t.views).toBe(304);
    expect(t.events).toBe(773);
    expect(t.activeUsers).toBe(123); // not summed — can't add uniques
  });
  it('is all-zero on an empty response', () => {
    expect(parseTotals({})).toEqual({ views: 0, activeUsers: 0, avgEngagementSec: 0, events: 0 });
  });
});

describe('parsePages', () => {
  it('maps rows and sorts by views desc', () => {
    const pages = parsePages(resp([
      { title: 'Blog — Notes | Oven AI', views: 67, users: 5, engagementSec: 1028, events: 117 },
      { title: 'Oven AI — Create 3D Icons', views: 237, users: 123, engagementSec: 2327, events: 656 },
    ]));
    expect(pages.map((p) => p.title)).toEqual([
      'Oven AI — Create 3D Icons',
      'Blog — Notes | Oven AI',
    ]);
    expect(pages[0].avgEngagementSec).toBeCloseTo(2327 / 123);
    expect(pages[1].avgEngagementSec).toBeCloseTo(205.6);
  });
  it('labels a missing title as (not set)', () => {
    const pages = parsePages(resp([{ views: 1, users: 1, engagementSec: 0, events: 1 }]));
    expect(pages[0].title).toBe('(not set)');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(18)).toBe('18s');
    expect(formatDuration(206)).toBe('3m 26s');
    expect(formatDuration(3840)).toBe('1h 4m');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
  });
});
