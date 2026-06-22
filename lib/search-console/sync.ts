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

export type SyncResult = { ok: boolean; pages: number; queries: number; reason?: string };

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

  // GSC data lags ~2 days; trail 28 days ending 2 days ago.
  const end = new Date(Date.now() - 2 * 86400_000);
  const start = new Date(end.getTime() - 27 * 86400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);

  let pageRows: GscRow[] = [];
  let queryRows: GscRow[] = [];
  try {
    [pageRows, queryRows] = await Promise.all([
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate, endDate, dimensions: ['page'], rowLimit: 200 }),
      querySearchAnalytics(accessToken, conn.siteUrl, { startDate, endDate, dimensions: ['query'], rowLimit: 200 }),
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
  await sb.from('domains').update({ gsc_synced_at: new Date().toISOString() }).eq('id', domainId);

  return { ok: true, pages: pageRows.length, queries: queryRows.length };
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
