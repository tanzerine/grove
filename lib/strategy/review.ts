/**
 * Monthly strategy review — turns raw post_events into a structured
 * `MonthlyReport` the manager / strategist agents can read.
 *
 * No LLM here: this is pure aggregation. The strategist agent gets the
 * report on its next planning call and decides what to keep / change.
 */
import { supabaseAdmin } from '../supabase/admin';
import { latestSnapshot } from '../search-console/sync';
import { summarize, type Visibility, type MetricRow } from '../search-console/insights';

export type ReportPostRow = {
  post_id: string;
  title: string;
  slug: string | null;
  pillar_id: string | null;
  goal_id: string | null;
  kpi_id: string | null;
  intent: string | null;
  views: number;
  unique_sessions: number;
  median_dwell_sec: number;
  scroll_75_rate: number;       // % of sessions that crossed 75%
  scroll_100_rate: number;
  outbound_rate: number;        // % of sessions with an outbound click
  conversions: number;
};

export type ReportReferrer = {
  host: string;
  sessions: number;
  share: number;                // 0..1
};

export type ReportQuery = {
  query: string;
  sessions: number;
};

export type MonthlyReport = {
  month: string;
  posts_count: number;
  totals: {
    views: number;
    unique_sessions: number;
    median_dwell_sec: number;
    scroll_completion_rate: number;
    outbound_to_product_rate: number;
    conversions: number;
    organic_share: number;
  };
  per_pillar: Record<string, ReportPostRow>;
  per_intent: Record<'editorial' | 'contextual' | 'conversion', ReportPostRow>;
  top_posts: ReportPostRow[];      // top 5 by views
  bottom_posts: ReportPostRow[];   // bottom 5
  top_referrers: ReportReferrer[];
  top_queries: ReportQuery[];
  // Real Google Search Console signal (impressions/position/near-winners).
  // null until the owner connects GSC — it's the loop's only pre-traffic signal.
  search_console?: Visibility | null;
};

const ORGANIC_HOSTS = ['google.com', 'bing.com', 'duckduckgo.com', 'baidu.com', 'naver.com', 'yandex.com'];

function pct(num: number, den: number) {
  return den > 0 ? num / den : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Aggregate `post_events` for one domain over [from, to).
 */
export async function summarizeMonth(
  domainId: string,
  from: Date,
  to: Date,
): Promise<MonthlyReport> {
  const sb = supabaseAdmin();
  const monthLabel = from.toISOString().slice(0, 7);

  // 1. published posts in domain (so we can tag events with pillar/intent
  //    from the strategy that was active when each was generated)
  const { data: posts = [] } = await sb
    .from('posts')
    .select('id,title,slug,research')
    .eq('domain_id', domainId)
    .eq('status', 'published');

  const briefByPostId = new Map<string, { pillar_id: string | null; goal_id: string | null; kpi_id: string | null; intent: string | null }>();
  for (const p of posts ?? []) {
    const brief = (p as any).research?.brief ?? null;
    briefByPostId.set(p.id, {
      pillar_id: brief?.pillar_id ?? null,
      goal_id: brief?.goal_id ?? null,
      kpi_id: brief?.kpi_id ?? null,
      intent: brief?.marketing_intent ?? null,
    });
  }
  const titleById = new Map((posts ?? []).map((p) => [p.id, { title: (p as any).title ?? '', slug: (p as any).slug ?? null }]));

  // 2. pull events for the window — paginate manually to be safe
  const { data: events = [] } = await sb
    .from('post_events')
    .select('post_id,type,session_id,referrer_host,query,scroll_depth,dwell_ms')
    .eq('domain_id', domainId)
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString())
    .limit(50_000);

  // 3. bucket events per post + session
  type PerSession = { maxScroll: number; lastDwell: number; outbound: boolean; conversion: boolean; referrer: string | null; query: string | null };
  const perPost = new Map<string, { sessions: Map<string, PerSession>; views: number }>();
  for (const ev of events ?? []) {
    const post = perPost.get(ev.post_id) ?? { sessions: new Map(), views: 0 };
    if (ev.type === 'view') post.views++;
    const sess = post.sessions.get(ev.session_id) ?? { maxScroll: 0, lastDwell: 0, outbound: false, conversion: false, referrer: null, query: null };
    if (ev.scroll_depth && ev.scroll_depth > sess.maxScroll) sess.maxScroll = ev.scroll_depth;
    if (ev.dwell_ms && ev.dwell_ms > sess.lastDwell) sess.lastDwell = ev.dwell_ms;
    if (ev.type === 'outbound') sess.outbound = true;
    if (ev.type === 'conversion') sess.conversion = true;
    if (ev.referrer_host && !sess.referrer) sess.referrer = ev.referrer_host;
    if (ev.query && !sess.query) sess.query = ev.query;
    post.sessions.set(ev.session_id, sess);
    perPost.set(ev.post_id, post);
  }

  // 4. build per-post rows
  const rows: ReportPostRow[] = [];
  for (const [postId, p] of perPost.entries()) {
    const meta = titleById.get(postId);
    if (!meta) continue;
    const brief = briefByPostId.get(postId) ?? { pillar_id: null, goal_id: null, kpi_id: null, intent: null };
    const sessions = Array.from(p.sessions.values());
    const dwellSecs = sessions.map((s) => Math.round(s.lastDwell / 1000)).filter((n) => n > 0);
    rows.push({
      post_id: postId,
      title: meta.title,
      slug: meta.slug,
      pillar_id: brief.pillar_id,
      goal_id: brief.goal_id,
      kpi_id: brief.kpi_id,
      intent: brief.intent,
      views: p.views,
      unique_sessions: sessions.length,
      median_dwell_sec: median(dwellSecs),
      scroll_75_rate: pct(sessions.filter((s) => s.maxScroll >= 75).length, sessions.length),
      scroll_100_rate: pct(sessions.filter((s) => s.maxScroll >= 100).length, sessions.length),
      outbound_rate: pct(sessions.filter((s) => s.outbound).length, sessions.length),
      conversions: sessions.filter((s) => s.conversion).length,
    });
  }

  // 5. totals + grouped views
  const allSessions = ([] as PerSession[]).concat(...Array.from(perPost.values()).map((p) => Array.from(p.sessions.values())));
  const totalViews = rows.reduce((a, r) => a + r.views, 0);
  const totalSessions = allSessions.length;
  const organicSessions = allSessions.filter((s) => s.referrer && ORGANIC_HOSTS.some((h) => s.referrer!.endsWith(h))).length;

  const totals = {
    views: totalViews,
    unique_sessions: totalSessions,
    median_dwell_sec: median(allSessions.map((s) => Math.round(s.lastDwell / 1000)).filter((n) => n > 0)),
    scroll_completion_rate: pct(allSessions.filter((s) => s.maxScroll >= 100).length, totalSessions),
    outbound_to_product_rate: pct(allSessions.filter((s) => s.outbound).length, totalSessions),
    conversions: allSessions.filter((s) => s.conversion).length,
    organic_share: pct(organicSessions, totalSessions),
  };

  const groupAccum = (key: 'pillar_id' | 'intent', value: string | null, into: Record<string, ReportPostRow>) => {
    if (value == null) return;
    const existing = into[value];
    if (!existing) into[value] = { ...rows[0], pillar_id: null, intent: null, post_id: value, title: value, slug: null, goal_id: null, kpi_id: null, views: 0, unique_sessions: 0, median_dwell_sec: 0, scroll_75_rate: 0, scroll_100_rate: 0, outbound_rate: 0, conversions: 0 };
  };

  const per_pillar: Record<string, ReportPostRow> = {};
  const per_intent: Record<string, ReportPostRow> = {};
  for (const r of rows) {
    if (r.pillar_id) {
      groupAccum('pillar_id', r.pillar_id, per_pillar);
      const g = per_pillar[r.pillar_id];
      g.views += r.views;
      g.unique_sessions += r.unique_sessions;
      g.conversions += r.conversions;
    }
    if (r.intent) {
      groupAccum('intent', r.intent, per_intent);
      const g = per_intent[r.intent];
      g.views += r.views;
      g.unique_sessions += r.unique_sessions;
      g.conversions += r.conversions;
    }
  }

  // top / bottom — only meaningful with ≥ 3 posts
  const sortedByViews = [...rows].sort((a, b) => b.views - a.views);
  const top_posts = sortedByViews.slice(0, 5);
  const bottom_posts = rows.length >= 6 ? sortedByViews.slice(-5).reverse() : [];

  // referrers
  const refCounts = new Map<string, number>();
  for (const s of allSessions) {
    if (!s.referrer) continue;
    refCounts.set(s.referrer, (refCounts.get(s.referrer) ?? 0) + 1);
  }
  const top_referrers: ReportReferrer[] = Array.from(refCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, sessions]) => ({ host, sessions, share: pct(sessions, totalSessions) }));

  // queries
  const queryCounts = new Map<string, number>();
  for (const s of allSessions) {
    if (!s.query) continue;
    queryCounts.set(s.query, (queryCounts.get(s.query) ?? 0) + 1);
  }
  const top_queries: ReportQuery[] = Array.from(queryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([query, sessions]) => ({ query, sessions }));

  // Real search visibility from GSC (best-effort — null if not connected).
  let search_console: Visibility | null = null;
  try {
    const snap = await latestSnapshot(domainId);
    if (snap.pages.length || snap.queries.length) {
      const toRow = (r: any): MetricRow => ({
        key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position, post_id: r.post_id ?? null,
      });
      search_console = summarize(snap.pages.map(toRow), snap.queries.map(toRow), snap.pageQueries ?? []);
    }
  } catch { /* GSC is optional signal */ }

  return {
    month: monthLabel,
    posts_count: rows.length,
    totals,
    per_pillar: per_pillar as Record<string, ReportPostRow>,
    per_intent: per_intent as Record<'editorial' | 'contextual' | 'conversion', ReportPostRow>,
    top_posts,
    bottom_posts,
    top_referrers,
    top_queries,
    search_console,
  };
}
