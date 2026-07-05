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
  trafficSources, answerReferrals, funnel, filterWindow, viewsByDay, postRollup,
  type EventRow, type TrafficSource, type AnswerReferrals, type Funnel, type DayViews,
} from './aggregate';
import { buildServiceState, type ServiceState } from './service-state';

export type KpiSummary = {
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
  queryCount: number;
} | null;

/** First-party aggregates recomputed per trailing window, so the dashboard's
 *  7d / 30d / 90d selector applies to reader data, not just GSC. */
export type FirstPartyWindow = {
  days: number;
  traffic: { total: number; sources: TrafficSource[] } | null;
  answers: AnswerReferrals | null;
  funnel: Funnel | null;
};

/** Per-post reader engagement — the events-only stand-in for GSC top pages. */
export type FirstPartyContent = {
  postId: string;
  title: string;
  views: number;
  read50: number;
  conversions: number;
};

export type AnalyticsData = {
  live: KpiSummary;
  series: DailyPoint[] | null;
  topContent: ContentRow[] | null;
  ranking: { bands: RankBand[]; total: number } | null;
  // 90-day first-party aggregates (kept for "any live signal" detection)…
  traffic: { total: number; sources: TrafficSource[] } | null;
  answers: AnswerReferrals | null;
  funnel: Funnel | null;
  // …and the period-aware versions of the same, plus the reads trend.
  firstParty: FirstPartyWindow[] | null;
  readsSeries: DayViews[] | null;
  fpContent: FirstPartyContent[] | null;
};

const EMPTY: AnalyticsData = {
  live: null, series: null, topContent: null, ranking: null,
  traffic: null, answers: null, funnel: null,
  firstParty: null, readsSeries: null, fpContent: null,
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
    const now = new Date();
    const since = new Date(now.getTime() - 90 * 86400_000).toISOString();
    const { data } = await sb
      .from('post_events')
      .select('type, referrer_host, utm_source, scroll_depth, session_id, created_at, post_id')
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

      // Same aggregates per trailing window, so the period selector is honest
      // for reader data too. Zero-signal windows stay null → empty state.
      out.firstParty = [7, 30, 90].map((days) => {
        const w = filterWindow(events, days, now);
        const t = trafficSources(w);
        const a = answerReferrals(w);
        const fu = funnel(w);
        return {
          days,
          traffic: t.total > 0 ? t : null,
          answers: a.total > 0 ? a : null,
          funnel: fu.clicks > 0 ? fu : null,
        };
      });

      const reads = viewsByDay(events, 90, now);
      if (reads.length >= 2) out.readsSeries = reads;

      // Per-post engagement — fills the top-content table before GSC exists.
      const rollup = postRollup(events);
      if (rollup.length) {
        const { data: titled } = await sb
          .from('posts').select('id, title').in('id', rollup.map((r) => r.post_id));
        const titleById = new Map((titled ?? []).map((p: any) => [p.id as string, (p.title ?? '') as string]));
        out.fpContent = rollup.map((r) => ({
          postId: r.post_id,
          title: titleById.get(r.post_id) || 'Untitled post',
          views: r.views, read50: r.read50, conversions: r.conversions,
        }));
      }
    }
  } catch { /* fail-soft */ }

  return out;
}

/**
 * Operational status for the analytics status strip and the agent's context.
 * All queries are head-counts or single rows — cheap enough to run per view.
 * Fail-soft like everything else on this page: an error just reads as "off".
 */
export async function loadServiceState(
  sb: SupabaseClient,
  domain: { id: string } & Record<string, any>,
  gscConfigured: boolean,
): Promise<ServiceState> {
  const now = new Date();
  const domainId = domain.id;

  const count = async (apply: (q: any) => any): Promise<number> => {
    try {
      const q = sb.from('posts').select('id', { count: 'exact', head: true }).eq('domain_id', domainId);
      const { count: n } = await apply(q);
      return n ?? 0;
    } catch { return 0; }
  };

  const [published, inReview, inFlight, scheduled, failed, nextSched, lastPub, lastEvent, events7d, evals] =
    await Promise.all([
      count((q) => q.eq('status', 'published')),
      count((q) => q.eq('status', 'review')),
      count((q) => q.in('status', ['queued', 'researching', 'writing'])),
      count((q) => q.eq('status', 'scheduled')),
      count((q) => q.eq('status', 'failed')),
      sb.from('posts').select('scheduled_at').eq('domain_id', domainId)
        .eq('status', 'scheduled').order('scheduled_at', { ascending: true })
        .limit(1).maybeSingle(),
      sb.from('posts').select('published_at').eq('domain_id', domainId)
        .eq('status', 'published').order('published_at', { ascending: false })
        .limit(1).maybeSingle(),
      sb.from('post_events').select('created_at').eq('domain_id', domainId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      (async () => {
        try {
          const { count: n } = await sb.from('post_events')
            .select('id', { count: 'exact', head: true })
            .eq('domain_id', domainId)
            .gte('created_at', new Date(now.getTime() - 7 * 86400_000).toISOString());
          return n ?? 0;
        } catch { return 0; }
      })(),
      sb.from('post_evaluations')
        .select('scores, posts!inner(domain_id)')
        .eq('posts.domain_id', domainId)
        .gte('created_at', new Date(now.getTime() - 30 * 86400_000).toISOString())
        .limit(100),
    ]);

  const overalls = ((evals as any)?.data ?? [])
    .map((r: any) => Number(r?.scores?.overall))
    .filter((n: number) => Number.isFinite(n));

  return buildServiceState({
    now,
    posts: {
      published, inFlight, inReview, scheduled, failed,
      nextScheduledAt: (nextSched as any)?.data?.scheduled_at ?? null,
      lastPublishedAt: (lastPub as any)?.data?.published_at ?? null,
    },
    gsc: {
      configured: gscConfigured,
      connected: !!domain.gsc_connected_at,
      verified: !!domain.gsc_site_url,
      syncedAt: domain.gsc_synced_at ?? null,
    },
    tracking: {
      lastEventAt: (lastEvent as any)?.data?.created_at ?? null,
      events7d: events7d as number,
    },
    quality: {
      avgScore: overalls.length ? overalls.reduce((a: number, b: number) => a + b, 0) / overalls.length : null,
      evaluated: overalls.length,
    },
  });
}
