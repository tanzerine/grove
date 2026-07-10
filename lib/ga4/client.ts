/**
 * Google Analytics 4 — read-only client.
 *
 * Plain `fetch` against the GA4 Admin API (property discovery) and Data API
 * (reports), mirroring lib/search-console/client.ts. It reuses the SAME Google
 * OAuth refresh token that Search Console stored (`gsc_refresh_token`) — the
 * analytics.readonly scope was added to the shared consent — so there is no
 * second connect button and no second token to manage.
 *
 * Setup in Google Cloud (same project as Search Console):
 *   - enable "Google Analytics Data API" and "Google Analytics Admin API"
 *   - add the analytics.readonly scope to the OAuth consent screen
 *
 * GA is queried LIVE per dashboard load (see lib/analytics/dashboard.ts), so
 * nothing here is cached — the caller passes the selected date range.
 */
import { supabaseAdmin } from '../supabase/admin';
import { accessTokenFromRefresh } from '../search-console/client';
import { decryptToken } from '../social/crypto';
import { verificationIdentifier } from '../search-console/client';

const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

/** Reuse the Google refresh token stored by the Search Console connect flow. */
export async function loadGoogleRefreshToken(domainId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('domains').select('gsc_refresh_token').eq('id', domainId).maybeSingle();
  return data?.gsc_refresh_token ? decryptToken(data.gsc_refresh_token) : null;
}

/* ─────────────────────────── property discovery ─────────────────────────── */

export type Ga4PropertySummary = { property: string; displayName: string };

/**
 * Every GA4 property the connected Google account can read, flattened across
 * accounts. `property` is the resource name "properties/123456789".
 */
export async function listProperties(accessToken: string): Promise<Ga4PropertySummary[]> {
  const r = await fetch(`${ADMIN_BASE}/accountSummaries?pageSize=200`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`ga4 accountSummaries failed: ${await r.text()}`);
  const j = await r.json();
  const out: Ga4PropertySummary[] = [];
  for (const acct of j?.accountSummaries ?? []) {
    for (const p of acct?.propertySummaries ?? []) {
      if (p?.property) out.push({ property: p.property, displayName: p.displayName ?? '' });
    }
  }
  return out;
}

/** Web-stream default URIs for a property, used to match it to a hostname. */
export async function propertyStreamHosts(accessToken: string, property: string): Promise<string[]> {
  const r = await fetch(`${ADMIN_BASE}/${property}/dataStreams?pageSize=50`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return []; // best-effort — a stream we can't list just doesn't match
  const j = await r.json();
  const hosts: string[] = [];
  for (const s of j?.dataStreams ?? []) {
    const uri = s?.webStreamData?.defaultUri;
    if (uri) { try { hosts.push(new URL(uri).hostname.replace(/^www\./, '').toLowerCase()); } catch { /* skip */ } }
  }
  return hosts;
}

/** Numeric property id from a "properties/123" resource name (or a bare id). */
export function propertyId(property: string): string {
  return property.replace(/^properties\//, '');
}

/**
 * Pick the GA4 property for this domain. One property → use it. Otherwise match
 * a web stream's host to the domain, then fall back to a displayName that
 * contains the domain's second-level label. Returns null if nothing matches.
 */
export async function resolveProperty(accessToken: string, hostname: string): Promise<string | null> {
  const host = verificationIdentifier(hostname);
  const props = await listProperties(accessToken);
  if (props.length === 0) return null;
  if (props.length === 1) return propertyId(props[0].property);

  // Match by web-stream host (authoritative), capped so we don't fan out forever.
  for (const p of props.slice(0, 15)) {
    const hosts = await propertyStreamHosts(accessToken, p.property);
    if (hosts.some((h) => h === host || h.endsWith('.' + host) || host.endsWith('.' + h))) {
      return propertyId(p.property);
    }
  }
  // Weak fallback: displayName mentions the site's label (e.g. "oveners").
  const label = host.split('.')[0];
  const named = props.find((p) => p.displayName.toLowerCase().includes(label));
  return named ? propertyId(named.property) : null;
}

/* ──────────────────────────────── reports ───────────────────────────────── */

export type GaDateRange = { startDate: string; endDate: string }; // 'NdaysAgo' | 'today' | 'YYYY-MM-DD'

/** Minimal shape of a GA4 Data API runReport response (the fields we read). */
export type GaRunReportResponse = {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string; type?: string }[];
  rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
};

/** One GA4 runReport call. `dimensions` may be empty for a totals-only report. */
export async function runReport(
  accessToken: string,
  property: string,
  opts: { dateRange: GaDateRange; dimensions: string[]; metrics: string[]; limit?: number },
): Promise<GaRunReportResponse> {
  const r = await fetch(`${DATA_BASE}/properties/${propertyId(property)}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: opts.dateRange.startDate, endDate: opts.dateRange.endDate }],
      dimensions: opts.dimensions.map((name) => ({ name })),
      metrics: opts.metrics.map((name) => ({ name })),
      limit: String(opts.limit ?? 250),
      keepEmptyRows: false,
    }),
  });
  if (!r.ok) throw new Error(`ga4 runReport failed: ${await r.text()}`);
  return (await r.json()) as GaRunReportResponse;
}

export { accessTokenFromRefresh };
