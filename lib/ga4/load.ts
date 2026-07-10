/**
 * Live GA4 fetch for the analytics dashboard. Called on each page load with the
 * selected date range (7d / 30d / 90d / 12mo) — no caching, no table — so the
 * period selector is honest. Fail-soft: any error yields null and the dashboard
 * falls back to Search Console + first-party sections.
 */
import {
  loadGoogleRefreshToken, accessTokenFromRefresh, runReport,
} from './client';
import { GA_METRICS, parseTotals, parsePages, type SiteTotals, type GaPageRow } from './insights';

export type Ga4Data = { totals: SiteTotals; pages: GaPageRow[] } | null;

export async function loadGa4(domainId: string, propertyId: string, days: number): Promise<Ga4Data> {
  try {
    const refresh = await loadGoogleRefreshToken(domainId);
    if (!refresh) return null;
    const accessToken = await accessTokenFromRefresh(refresh);
    const dateRange = { startDate: `${Math.max(1, days)}daysAgo`, endDate: 'today' };

    const [totalsResp, pagesResp] = await Promise.all([
      runReport(accessToken, propertyId, { dateRange, dimensions: [], metrics: [...GA_METRICS] }),
      runReport(accessToken, propertyId, { dateRange, dimensions: ['pageTitle'], metrics: [...GA_METRICS], limit: 50 }),
    ]);

    const totals = parseTotals(totalsResp);
    if (totals.views <= 0 && totals.events <= 0) return null; // nothing to show yet
    return { totals, pages: parsePages(pagesResp) };
  } catch (e: any) {
    console.error('[ga4 load] failed', domainId, e?.message ?? e);
    return null;
  }
}
