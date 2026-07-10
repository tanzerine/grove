/**
 * Pure GA4 report parsing — no I/O, unit-tested (mirrors lib/analytics/aggregate.ts).
 *
 * Turns a GA4 Data API `runReport` response into the whole-site shapes the
 * analytics dashboard renders:
 *   - site totals: page views, active users, avg engagement time, event count
 *   - per-page rows (landing page + blog index + every article), same columns
 *     GA shows: 조회수 / 활성 사용자 / 활성 사용자당 평균 참여 시간 / 이벤트 수
 *
 * "Avg engagement time per active user" is GA's own definition:
 * userEngagementDuration (seconds) ÷ activeUsers — matches the export exactly.
 */
import type { GaRunReportResponse } from './client';

/** GA4 metric api-names we request; parsing is keyed by these, order-independent. */
export const GA_METRICS = ['screenPageViews', 'activeUsers', 'userEngagementDuration', 'eventCount'] as const;

export type SiteTotals = {
  views: number;
  activeUsers: number;
  avgEngagementSec: number; // per active user
  events: number;
};

export type GaPageRow = {
  title: string;
  views: number;
  activeUsers: number;
  avgEngagementSec: number;
  events: number;
};

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Column index of a metric by api-name, or -1. */
function metricIndex(resp: GaRunReportResponse, name: string): number {
  return (resp.metricHeaders ?? []).findIndex((h) => h.name === name);
}

function metric(row: NonNullable<GaRunReportResponse['rows']>[number], idx: number): number {
  if (idx < 0) return 0;
  return num(row.metricValues?.[idx]?.value);
}

/** Avg engagement seconds per active user, guarding divide-by-zero. */
export function avgEngagement(engagementSec: number, activeUsers: number): number {
  if (activeUsers <= 0) return 0;
  return engagementSec / activeUsers;
}

/** Site-wide totals from a no-dimension (or summed) report. */
export function parseTotals(resp: GaRunReportResponse): SiteTotals {
  const vi = metricIndex(resp, 'screenPageViews');
  const ai = metricIndex(resp, 'activeUsers');
  const ei = metricIndex(resp, 'userEngagementDuration');
  const ci = metricIndex(resp, 'eventCount');
  const rows = resp.rows ?? [];
  // A totals report has one row; if the caller sent a dimension, sum the rows.
  // activeUsers can't be summed across pages meaningfully, so take the first
  // row's value when present (a totals report), else the max seen.
  let views = 0, engagement = 0, events = 0, activeUsers = 0;
  for (const r of rows) {
    views += metric(r, vi);
    engagement += metric(r, ei);
    events += metric(r, ci);
    activeUsers = Math.max(activeUsers, metric(r, ai));
  }
  return { views, activeUsers, avgEngagementSec: avgEngagement(engagement, activeUsers), events };
}

/**
 * Per-page rows (dimension = pageTitle), newest-report order preserved but
 * sorted by views desc so the landing page + blog index surface at the top —
 * exactly the ordering the owner sees in GA.
 */
export function parsePages(resp: GaRunReportResponse): GaPageRow[] {
  const vi = metricIndex(resp, 'screenPageViews');
  const ai = metricIndex(resp, 'activeUsers');
  const ei = metricIndex(resp, 'userEngagementDuration');
  const ci = metricIndex(resp, 'eventCount');
  const rows = resp.rows ?? [];
  return rows
    .map((r) => {
      const activeUsers = metric(r, ai);
      return {
        title: r.dimensionValues?.[0]?.value ?? '(not set)',
        views: metric(r, vi),
        activeUsers,
        avgEngagementSec: avgEngagement(metric(r, ei), activeUsers),
        events: metric(r, ci),
      };
    })
    .sort((a, b) => b.views - a.views);
}

/** Human duration: "18s", "3m 26s", "1h 4m". GA-style, no zero-padding. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
