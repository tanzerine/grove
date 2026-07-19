/**
 * Signals for the dashboard assistant — the owner's REAL data, deep enough
 * that "am I getting new users?" gets answered from numbers, per article,
 * not with generic marketing advice. Split like agent-brief:
 *   - gatherSignals()  → queries (admin client; caller must own the domain)
 *   - signalsBlock()   → pure text from those numbers (unit-tested)
 * Every section is fail-soft: a missing GSC/GA4 connection or empty events
 * table just leaves fields null and the block says so explicitly, so the
 * model can name the missing connection instead of claiming "no access".
 */
import { supabaseAdmin } from '../supabase/admin';
import { getBriefStats, type BriefStats } from '../agent-brief';
import { summarizeMonth } from '../strategy/review';
import { latestSnapshot } from '../search-console/sync';
import { summarize, articleRows, type ArticleInfo, type MetricRow } from '../search-console/insights';
import {
  trafficSources, funnel, engagement,
  type EventRow, type TrafficSource, type Funnel, type Engagement,
} from '../analytics/aggregate';
import { loadGa4 } from '../ga4/load';

/** One published article with everything we know about it. */
export type ArticleSignal = {
  title: string;
  reads: number;         // first-party reader views (all time)
  clicks: number;        // GSC clicks (latest snapshot window)
  impressions: number;
  ctr: number;           // 0..1
  position: number;
};

export type AssistantSignals = {
  brief: BriefStats;
  month: {                       // calendar month-to-date vs previous month
    views: number; prevViews: number;
    uniqueSessions: number;
    conversions: number; prevConversions: number;
    organicShare: number;
    medianDwellSec: number;
    outboundRate: number;        // % of sessions that clicked through to the product site
    topPosts: Array<{ title: string; views: number; conversions: number }>;
  } | null;
  /** Per-article table (every published article, capped for the prompt). */
  articles: ArticleSignal[] | null;
  articlesTotal: number;
  /** First-party reader funnel over the last 30 days, de-duped by session. */
  funnel: Funnel | null;
  traffic: { total: number; sources: TrafficSource[] } | null;
  engagement: Engagement | null;
  gsc: { clicks: number; impressions: number; ctr: number; avgPosition: number } | null;
  /** Whole-site Google Analytics (last 30 days), when GA4 is connected. */
  ga: { views: number; activeUsers: number; avgEngagementSec: number } | null;
  setup: {
    gscConnected: boolean;
    ga4Connected: boolean;
    canonicalBase: string | null;
    customHostname: string | null;
    autoPublish: boolean;
    postsPerWeek: number;
  };
};

const ARTICLE_CAP = 12;   // prompt budget: every article when small, top rows when large

export async function gatherSignals(domainId: string, hostname: string): Promise<AssistantSignals> {
  const sb = supabaseAdmin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const since30d = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [brief, thisMonth, prevMonth, domainRow, snap, postsRes, eventsRes] = await Promise.all([
    getBriefStats(domainId, hostname),
    summarizeMonth(domainId, monthStart, now).catch(() => null),
    summarizeMonth(domainId, prevStart, monthStart).catch(() => null),
    sb.from('domains')
      .select('gsc_site_url, ga4_property_id, canonical_blog_base, custom_blog_hostname, auto_publish, posts_per_week')
      .eq('id', domainId).maybeSingle().then((r) => r.data as any, () => null),
    latestSnapshot(domainId).catch(() => null),
    sb.from('posts').select('id, title, slug, reads')
      .eq('domain_id', domainId).eq('status', 'published')
      .then((r) => (r.data ?? []) as ArticleInfo[], () => [] as ArticleInfo[]),
    sb.from('post_events')
      .select('type, referrer_host, utm_source, scroll_depth, session_id, dwell_ms')
      .eq('domain_id', domainId).gte('created_at', since30d).limit(20000)
      .then((r) => (r.data ?? []) as EventRow[], () => [] as EventRow[]),
  ]);

  // GA4 is a live HTTP call — only attempt it when actually connected.
  const ga4PropertyId = domainRow?.ga4_property_id ?? null;
  const ga = ga4PropertyId ? await loadGa4(domainId, ga4PropertyId, 30) : null;

  const toRow = (r: any): MetricRow => ({
    key: r.key, clicks: r.clicks, impressions: r.impressions,
    position: r.position, post_id: r.post_id ?? null,
  });
  const pages = (snap?.pages ?? []).map(toRow);

  // Per-article view: GSC folded onto every published post (zeroes before
  // GSC connects — reads are still real), sorted by search footprint.
  const rows = articleRows(pages, postsRes);
  const articles: ArticleSignal[] = rows
    .slice()
    .sort((a, b) => b.impressions - a.impressions || b.views - a.views)
    .slice(0, ARTICLE_CAP)
    .map((r) => ({
      title: r.title, reads: r.views,
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));

  let gsc: AssistantSignals['gsc'] = null;
  if (domainRow?.gsc_site_url && snap && (snap.pages.length || snap.queries.length)) {
    const v = summarize(pages, (snap.queries ?? []).map(toRow));
    if (v.impressions > 0) gsc = { clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, avgPosition: v.avgPosition };
  }

  const t = eventsRes.length ? trafficSources(eventsRes) : null;
  const f = eventsRes.length ? funnel(eventsRes) : null;
  const eng = eventsRes.length ? engagement(eventsRes) : null;

  return {
    brief,
    month: thisMonth ? {
      views: thisMonth.totals.views,
      prevViews: prevMonth?.totals.views ?? 0,
      uniqueSessions: thisMonth.totals.unique_sessions,
      conversions: thisMonth.totals.conversions,
      prevConversions: prevMonth?.totals.conversions ?? 0,
      organicShare: thisMonth.totals.organic_share,
      medianDwellSec: thisMonth.totals.median_dwell_sec,
      outboundRate: thisMonth.totals.outbound_to_product_rate,
      topPosts: (thisMonth.top_posts ?? []).slice(0, 3)
        .filter((p) => p.views > 0)
        .map((p) => ({ title: p.title, views: p.views, conversions: p.conversions })),
    } : null,
    articles: articles.length ? articles : null,
    articlesTotal: rows.length,
    funnel: f && f.clicks > 0 ? f : null,
    traffic: t && t.total > 0 ? t : null,
    engagement: eng && eng.events > 0 ? eng : null,
    gsc,
    ga: ga ? { views: ga.totals.views, activeUsers: ga.totals.activeUsers, avgEngagementSec: ga.totals.avgEngagementSec } : null,
    setup: {
      gscConnected: !!domainRow?.gsc_site_url,
      ga4Connected: !!ga4PropertyId,
      canonicalBase: domainRow?.canonical_blog_base ?? null,
      customHostname: domainRow?.custom_blog_hostname ?? null,
      autoPublish: !!domainRow?.auto_publish,
      postsPerWeek: domainRow?.posts_per_week ?? 4,
    },
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Render the signals as the block the prompt embeds. Pure. */
export function signalsBlock(s: AssistantSignals): string {
  const b = s.brief;
  const lines: string[] = [];

  lines.push(`Published articles: ${b.totalPublished} total, ${b.publishedThisWeek} this week. In pipeline: ${b.inFlight} drafting, ${b.inReview} awaiting review.`);
  if (b.nextScheduledAt) lines.push(`Next scheduled publish: ${b.nextScheduledAt.slice(0, 10)}.`);
  lines.push(`Reads this week: ${b.readsThisWeek} (last week ${b.readsLastWeek}).`);

  if (s.month) {
    const m = s.month;
    lines.push(`This month so far: ${m.views} article reads across ${m.uniqueSessions} unique readers (previous month total ${m.prevViews}). ${m.conversions} conversions (previous month ${m.prevConversions}); ${pct(m.outboundRate)} of reader sessions clicked through to ${b.hostname}. Organic share ${pct(m.organicShare)}, median time on page ${Math.round(m.medianDwellSec)}s.`);
    if (m.topPosts.length) {
      lines.push(`Top posts this month: ${m.topPosts.map((p) => `"${p.title}" (${p.views} reads, ${p.conversions} conversions)`).join(', ')}.`);
    }
  }

  if (s.funnel) {
    lines.push(`Reader funnel, last 30 days (unique sessions): ${s.funnel.clicks} opened an article → ${s.funnel.read50} read past halfway → ${s.funnel.converted} converted (clicked through and signed up / hit the CTA). New users FROM THE BLOG = that last number.`);
  } else {
    lines.push('Reader funnel: no reader events recorded in the last 30 days.');
  }

  if (s.traffic) {
    lines.push(`Where readers come from (last 30 days): ${s.traffic.sources.map((x) => `${x.name} ${x.pct}%`).join(', ')} of ${s.traffic.total} arrivals.`);
  }
  if (s.engagement) {
    lines.push(`Engagement (last 30 days): ${s.engagement.views} article views over ${s.engagement.sessions} sessions, average time on page ${Math.round(s.engagement.avgDwellSec)}s.`);
  }

  lines.push(s.gsc
    ? `Google Search (latest snapshot): ${s.gsc.clicks} clicks from ${s.gsc.impressions} impressions (CTR ${pct(s.gsc.ctr)}), average position ${s.gsc.avgPosition.toFixed(1)}.`
    : s.setup.gscConnected
      ? 'Google Search Console: connected, no impressions recorded yet.'
      : 'Google Search Console: NOT connected (no impressions/clicks data).');

  lines.push(s.ga
    ? `Google Analytics, whole site incl. landing pages (last 30 days): ${s.ga.views} pageviews, ${s.ga.activeUsers} active users, avg engagement ${Math.round(s.ga.avgEngagementSec)}s.`
    : s.setup.ga4Connected
      ? 'Google Analytics: connected, no data returned for the last 30 days.'
      : 'Google Analytics: not connected (whole-site user counts unavailable — blog-side numbers above are still real).');

  if (s.articles) {
    const rows = s.articles.map((a) =>
      `- "${a.title}" — ${a.reads} reads` +
      (a.impressions > 0
        ? `, ${a.clicks} clicks / ${a.impressions} impressions (CTR ${pct(a.ctr)}), avg position ${a.position.toFixed(1)}`
        : ', no search impressions yet'));
    const more = s.articlesTotal > s.articles.length ? `\n(and ${s.articlesTotal - s.articles.length} more articles with a smaller search footprint)` : '';
    lines.push(`PER-ARTICLE (live numbers for each published piece):\n${rows.join('\n')}${more}`);
  }

  lines.push(`Setup: autopilot ${s.setup.autoPublish ? 'ON' : 'OFF (review mode)'}, ${s.setup.postsPerWeek} posts/week, canonical base ${s.setup.canonicalBase ?? 'not set'}, custom hostname ${s.setup.customHostname ?? 'not set'}.`);

  return lines.join('\n');
}
