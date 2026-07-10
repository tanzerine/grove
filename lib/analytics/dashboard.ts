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
  summarize, rankingDistribution, articleRows,
  type MetricRow, type RankBand, type ContentRow, type ArticleInfo,
} from '../search-console/insights';
import {
  trafficSources, answerReferrals, funnel, engagement,
  type EventRow, type TrafficSource, type AnswerReferrals, type Funnel, type Engagement,
} from './aggregate';
import { loadGa4, type Ga4Data } from '../ga4/load';

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
  /** One row per published article (all of them), GSC + first-party views.
   *  null only when the domain has no published articles yet. */
  articles: ContentRow[] | null;
  ranking: { bands: RankBand[]; total: number } | null;
  traffic: { total: number; sources: TrafficSource[] } | null;
  answers: AnswerReferrals | null;
  funnel: Funnel | null;
  /** Whole-site Google Analytics (landing + blog + articles), live per range. */
  ga: Ga4Data;
  /** First-party engagement (dwell + event count) over blog articles. */
  engagement: Engagement | null;
};

const EMPTY: AnalyticsData = {
  live: null, series: null, articles: null, ranking: null,
  traffic: null, answers: null, funnel: null, ga: null, engagement: null,
};

const toRow = (r: any): MetricRow => ({
  key: r.key, clicks: r.clicks, impressions: r.impressions,
  position: r.position, post_id: r.post_id ?? null,
});

/**
 * @param sb           user-scoped client (post_events is read under RLS)
 * @param domainId      active domain
 * @param verified      whether a GSC property is wired up (gsc_site_url present)
 * @param periodDays    selected window (7 / 30 / 90 / 365) — drives GA + events
 * @param ga4PropertyId GA4 numeric property id, or null when GA isn't connected
 */
export async function loadAnalytics(
  sb: SupabaseClient,
  domainId: string,
  verified: boolean,
  periodDays = 90,
  ga4PropertyId: string | null = null,
): Promise<AnalyticsData> {
  const out: AnalyticsData = { ...EMPTY };

  // ── Google Analytics — whole-site, queried LIVE for the selected range ─────
  if (ga4PropertyId) {
    out.ga = await loadGa4(domainId, ga4PropertyId, periodDays);
  }

  // Every published article, independent of GSC — the articles table must show
  // ALL articles even before Search Console is connected (views are still real,
  // GSC columns just read zero). `reads` is the per-article first-party view
  // counter shown across the rest of the product.
  let posts: ArticleInfo[] = [];
  try {
    const { data } = await supabaseAdmin()
      .from('posts').select('id, title, slug, reads')
      .eq('domain_id', domainId).eq('status', 'published')
      .order('published_at', { ascending: false });
    posts = (data ?? []) as ArticleInfo[];
  } catch { /* fail-soft */ }

  // ── Search Console (admin client; service role, same as sync) ──────────────
  let pages: MetricRow[] = [];
  if (verified) {
    try {
      const [snap, series] = await Promise.all([
        latestSnapshot(domainId),
        dailySeries(domainId, 90),
      ]);
      pages = snap.pages.map(toRow);
      const queries = snap.queries.map(toRow);

      if (pages.length || queries.length) {
        const v = summarize(pages, queries);
        if (v.impressions > 0) {
          out.live = { clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, avgPosition: v.avgPosition, queryCount: v.queryCount };
        }
        const rank = rankingDistribution(queries);
        if (rank.total > 0) out.ranking = rank;
      }
      if (series.length) out.series = series;
    } catch { /* fail-soft — section stays null, sample view shows */ }
  }

  // ── First-party events (RLS-scoped to the owner), windowed to the period ───
  try {
    const since = new Date(Date.now() - periodDays * 86400_000).toISOString();
    const { data } = await sb
      .from('post_events')
      .select('type, referrer_host, utm_source, scroll_depth, session_id, dwell_ms')
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
      const eng = engagement(events);
      if (eng.events > 0) out.engagement = eng;
    }
  } catch { /* fail-soft */ }

  const rows = articleRows(pages, posts);
  if (rows.length) out.articles = rows;

  return out;
}
