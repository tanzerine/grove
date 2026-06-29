/**
 * Server-side assembly for the analytics dashboard. Pulls a domain's real
 * signals — Search Console (snapshot + daily series) and first-party events —
 * and folds them into one payload the page renders. Each section is independent
 * and fail-soft: a missing GSC connection or an empty events table just yields
 * `null` for that section, and the dashboard falls back to its sample view.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { latestSnapshot, dailySeries, type DailyPoint } from '../search-console/sync';
import {
  summarize, rankingDistribution, topContent,
  type MetricRow, type RankBand, type ContentRow,
} from '../search-console/insights';
import {
  trafficSources, answerReferrals, funnel,
  type EventRow, type TrafficSource, type AnswerReferrals, type Funnel,
} from './aggregate';

export type KpiSummary = {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  queryCount: number;
} | null;

export type AnalyticsData = {
  live: KpiSummary;
  series: DailyPoint[] | null;
  topContent: ContentRow[] | null;
  ranking: { bands: RankBand[]; total: number } | null;
  traffic: { total: number; sources: TrafficSource[] } | null;
  answers: AnswerReferrals | null;
  funnel: Funnel | null;
};

const EMPTY: AnalyticsData = {
  live: null, series: null, topContent: null, ranking: null,
  traffic: null, answers: null, funnel: null,
};

const toRow = (r: any): MetricRow => ({
  key: r.key, clicks: r.clicks, impressions: r.impressions,
  position: r.position, post_id: r.post_id ?? null,
});

/**
 * @param sb       user-scoped client (post_events is read under RLS)
 * @param domainId active domain
 * @param verified whether a GSC property is wired up (gsc_site_url present)
 */
export async function loadAnalytics(
  sb: SupabaseClient,
  domainId: string,
  verified: boolean,
): Promise<AnalyticsData> {
  const out: AnalyticsData = { ...EMPTY };

  // ── Search Console (admin client; service role, same as sync) ──────────────
  if (verified) {
    try {
      const [snap, series, posts] = await Promise.all([
        latestSnapshot(domainId),
        dailySeries(domainId, 90),
        supabaseAdmin().from('posts').select('id, title').eq('domain_id', domainId),
      ]);
      const pages = snap.pages.map(toRow);
      const queries = snap.queries.map(toRow);

      if (pages.length || queries.length) {
        const v = summarize(pages, queries);
        if (v.impressions > 0) {
          out.live = { clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, avgPosition: v.avgPosition, queryCount: v.queryCount };
        }
        const titleById = new Map<string, string>();
        for (const p of (posts.data ?? []) as { id: string; title: string | null }[]) {
          if (p.title) titleById.set(p.id, p.title);
        }
        const content = topContent(pages, titleById);
        if (content.length) out.topContent = content;
        const rank = rankingDistribution(queries);
        if (rank.total > 0) out.ranking = rank;
      }
      if (series.length) out.series = series;
    } catch { /* fail-soft — section stays null, sample view shows */ }
  }

  // ── First-party events (RLS-scoped to the owner) ───────────────────────────
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data } = await sb
      .from('post_events')
      .select('type, referrer_host, utm_source, scroll_depth, session_id')
      .eq('domain_id', domainId)
      .gte('created_at', since)
      .limit(20000);
    const events = (data ?? []) as EventRow[];
    if (events.length) {
      const traffic = trafficSources(events);
      if (traffic.total > 0) out.traffic = traffic;
      const ans = answerReferrals(events);
      if (ans.total > 0) out.answers = ans;
      const f = funnel(events);
      if (f.clicks > 0) out.funnel = f;
    }
  } catch { /* fail-soft */ }

  return out;
}
