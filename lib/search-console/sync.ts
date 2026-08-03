/**
 * Pull a domain's Search Console performance and snapshot it into gsc_metrics.
 *
 * One trailing-28-day window per sync, stored under today's date. Runs from the
 * daily cron (best-effort) and on demand from the dashboard. Fail-soft: a GSC
 * outage or a revoked token must never break the tick — it just logs and skips.
 */
import { supabaseAdmin } from '../supabase/admin';
import { accessTokenFromRefresh, getConnection, querySearchAnalytics, type GscRow } from './client';

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Map a result page URL back to one of our published posts by trailing slug. */
function buildSlugIndex(posts: { id: string; slug: string | null }[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of posts) if (p.slug) idx.set(p.slug.toLowerCase(), p.id);
  return idx;
}
function postIdForUrl(url: string, slugIndex: Map<string, string>): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '');
    const last = path.split('/').filter(Boolean).pop();
    return last ? slugIndex.get(last.toLowerCase()) ?? null : null;
  } catch { return null; }
}

export type SyncResult = { ok: boolean; pages: number; queries: number; pageQueries?: number; reason?: string };

export async function syncDomain(domainId: string): Promise<SyncResult> {
  const conn = await getConnection(domainId);
  if (!conn) return { ok: false, pages: 0, queries: 0, reason: 'not_connected' };

  let accessToken: string;
  try {
    accessToken = await accessTokenFromRefresh(conn.refreshToken);
  } catch (e: any) {
    console.error('[gsc sync] token refresh failed', domainId, e?.message ?? e);
    return { ok: false, pages: 0, queries: 0, reason: 'auth' };
  }

  // GSC data lags ~2 days; trail 28 days ending 2 days ago for the snapshot.
  const end = new Date(Date.now() - 2 * 86400_000);
  const start = new Date(end.getTime() - 27 * 86400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);
  // The daily series powers the dashboard's trend chart — pull a wider 90-day
  // window so the 7d / 30d / 90d selector can slice it client-side.
  const dailyStartDate = ymd(new Date(end.getTime() - 89 * 86400_000));

  let pageRows: GscRow[] = [];
  let queryRows: GscRow[] = [];
  let dailyRows: GscRow[] = [];
  // The page+query pair, which neither of the two single-dimension calls above
  // can reconstruct: 'page' rows say where a page ranks, 'query' rows say what
  // we rank for, and nothing joins them. Refreshing a near-winner needs the
  // queries that specific page already earns impressions on, so it's a fourth
  // call rather than a derivation. Higher rowLimit because the pair fans out —
  // one page contributes a row per query it ranks for.
  let pageQueryRows: GscRow[] = [];
  try {
    [pageRows, queryRows, dailyRows, pageQueryRows] = await Promise.all([
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 200 }),
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate: dailyStartDate, endDate, dimensions: ['date'], rowLimit: 100 }),
      // Swallowed independently: this call feeds refresh targeting only, and
      // the three above feed the whole analytics dashboard. Letting a failure
      // here reject the Promise.all would turn "no refresh targeting" into "no
      // Search Console data at all" — a strictly worse trade.
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate, endDate, dimensions: ['page', 'query'], rowLimit: 500 })
        .catch((e: any) => {
          console.error('[gsc sync] page+query failed', domainId, e?.message ?? e);
          return [] as GscRow[];
        }),
    ]);
  } catch (e: any) {
    console.error('[gsc sync] query failed', domainId, e?.message ?? e);
    return { ok: false, pages: 0, queries: 0, reason: 'query' };
  }

  const sb = supabaseAdmin();
  const { data: posts } = await sb
    .from('posts').select('id, slug').eq('domain_id', domainId).eq('status', 'published');
  const slugIndex = buildSlugIndex((posts ?? []) as any);

  const today = ymd(new Date());
  const rows = [
    ...pageRows.map((r) => ({
      domain_id: domainId, dimension: 'page' as const, key: r.keys[0] ?? '',
      post_id: postIdForUrl(r.keys[0] ?? '', slugIndex),
      date: today, clicks: r.clicks, impressions: r.impressions, position: r.position,
    })),
    ...queryRows.map((r) => ({
      domain_id: domainId, dimension: 'query' as const, key: r.keys[0] ?? '',
      post_id: null, date: today, clicks: r.clicks, impressions: r.impressions, position: r.position,
    })),
  ].filter((r) => r.key);

  if (rows.length) {
    // upsert so a same-day re-sync overwrites rather than duplicates
    await sb.from('gsc_metrics').upsert(rows, { onConflict: 'domain_id,dimension,key,date' });
  }

  // Per-day series for the trend chart. keys[0] is the calendar day (YYYY-MM-DD).
  const dailyUpsert = dailyRows
    .filter((r) => r.keys[0])
    .map((r) => ({
      domain_id: domainId, date: r.keys[0],
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
  if (dailyUpsert.length) {
    await sb.from('gsc_daily').upsert(dailyUpsert, { onConflict: 'domain_id,date' });
  }

  // Per (page, query) rows — keys are in the order the dimensions were asked
  // for. Only rows we can attribute to one of our posts are worth storing: the
  // reader is "which queries does THIS article rank for", and an unattributed
  // page can't be rewritten anyway.
  const pageQueryUpsert = pageQueryRows
    .filter((r) => r.keys[0] && r.keys[1])
    .map((r) => ({
      domain_id: domainId, post_id: postIdForUrl(r.keys[0], slugIndex),
      page: r.keys[0], query: r.keys[1], date: today,
      clicks: r.clicks, impressions: r.impressions, position: r.position,
    }))
    .filter((r) => r.post_id);
  if (pageQueryUpsert.length) {
    // Best-effort for one release: the table arrives in 0032, and a sync
    // running against a database that hasn't applied it yet must still write
    // everything above rather than throw on the last statement.
    const { error } = await sb
      .from('gsc_page_queries')
      .upsert(pageQueryUpsert, { onConflict: 'domain_id,page,query,date' });
    if (error) console.error('[gsc sync] page_queries upsert failed', domainId, error.message);
  }

  await sb.from('domains').update({ gsc_synced_at: new Date().toISOString() }).eq('id', domainId);

  return { ok: true, pages: pageRows.length, queries: queryRows.length, pageQueries: pageQueryUpsert.length };
}

export type DailyPoint = { date: string; clicks: number; impressions: number; ctr: number; position: number };

/** Per-day GSC totals for the trend chart, oldest→newest, last `days` days. */
export async function dailySeries(domainId: string, days = 90): Promise<DailyPoint[]> {
  const sb = supabaseAdmin();
  const since = ymd(new Date(Date.now() - days * 86400_000));
  const { data } = await sb
    .from('gsc_daily')
    .select('date, clicks, impressions, ctr, position')
    .eq('domain_id', domainId).gte('date', since)
    .order('date', { ascending: true });
  return (data ?? []) as DailyPoint[];
}

/** Read the most recent snapshot back out for the dashboard / strategist. */
export async function latestSnapshot(domainId: string): Promise<{ pages: any[]; queries: any[]; date: string | null }> {
  const sb = supabaseAdmin();
  const { data: latest } = await sb
    .from('gsc_metrics').select('date').eq('domain_id', domainId)
    .order('date', { ascending: false }).limit(1).maybeSingle();
  const date = latest?.date ?? null;
  if (!date) return { pages: [], queries: [], date: null };

  const { data: rows } = await sb
    .from('gsc_metrics')
    .select('dimension, key, post_id, clicks, impressions, position')
    .eq('domain_id', domainId).eq('date', date);

  const pages = (rows ?? []).filter((r: any) => r.dimension === 'page');
  const queries = (rows ?? []).filter((r: any) => r.dimension === 'query');
  return { pages, queries, date };
}
