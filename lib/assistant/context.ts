/**
 * Signals for the dashboard assistant — one compact, token-cheap block of the
 * domain's real numbers the chat model may quote. Split like agent-brief:
 *   - gatherSignals()  → queries (admin client; caller must own the domain)
 *   - signalsBlock()   → pure text from those numbers (unit-tested)
 * Every section is fail-soft: a missing GSC connection or empty events table
 * just leaves fields null and the block says so.
 */
import { supabaseAdmin } from '../supabase/admin';
import { getBriefStats, type BriefStats } from '../agent-brief';
import { summarizeMonth } from '../strategy/review';
import { latestSnapshot } from '../search-console/sync';
import { summarize } from '../search-console/insights';

export type AssistantSignals = {
  brief: BriefStats;
  month: {                       // calendar month-to-date vs previous month
    views: number; prevViews: number;
    conversions: number; organicShare: number;
    topPosts: Array<{ title: string; views: number }>;
  } | null;
  gsc: { clicks: number; impressions: number; ctr: number; avgPosition: number } | null;
  setup: {
    gscConnected: boolean;
    ga4Connected: boolean;
    canonicalBase: string | null;
    customHostname: string | null;
    autoPublish: boolean;
    postsPerWeek: number;
  };
};

export async function gatherSignals(domainId: string, hostname: string): Promise<AssistantSignals> {
  const sb = supabaseAdmin();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const [brief, thisMonth, prevMonth, domainRow, snap] = await Promise.all([
    getBriefStats(domainId, hostname),
    summarizeMonth(domainId, monthStart, now).catch(() => null),
    summarizeMonth(domainId, prevStart, monthStart).catch(() => null),
    sb.from('domains')
      .select('gsc_site_url, ga4_property_id, canonical_blog_base, custom_blog_hostname, auto_publish, posts_per_week')
      .eq('id', domainId).maybeSingle().then((r) => r.data as any, () => null),
    latestSnapshot(domainId).catch(() => null),
  ]);

  let gsc: AssistantSignals['gsc'] = null;
  if (domainRow?.gsc_site_url && snap && (snap.pages.length || snap.queries.length)) {
    const v = summarize(
      snap.pages.map((r: any) => ({ key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position, post_id: r.post_id ?? null })),
      snap.queries.map((r: any) => ({ key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position, post_id: r.post_id ?? null })),
    );
    if (v.impressions > 0) gsc = { clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, avgPosition: v.avgPosition };
  }

  return {
    brief,
    month: thisMonth ? {
      views: thisMonth.totals.views,
      prevViews: prevMonth?.totals.views ?? 0,
      conversions: thisMonth.totals.conversions,
      organicShare: thisMonth.totals.organic_share,
      topPosts: (thisMonth.top_posts ?? []).slice(0, 3)
        .filter((p) => p.views > 0)
        .map((p) => ({ title: p.title, views: p.views })),
    } : null,
    gsc,
    setup: {
      gscConnected: !!domainRow?.gsc_site_url,
      ga4Connected: !!domainRow?.ga4_property_id,
      canonicalBase: domainRow?.canonical_blog_base ?? null,
      customHostname: domainRow?.custom_blog_hostname ?? null,
      autoPublish: !!domainRow?.auto_publish,
      postsPerWeek: domainRow?.posts_per_week ?? 4,
    },
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Render the signals as the compact block the prompt embeds. Pure. */
export function signalsBlock(s: AssistantSignals): string {
  const b = s.brief;
  const lines: string[] = [];

  lines.push(`Published articles: ${b.totalPublished} total, ${b.publishedThisWeek} this week. In pipeline: ${b.inFlight} drafting, ${b.inReview} awaiting review.`);
  if (b.nextScheduledAt) lines.push(`Next scheduled publish: ${b.nextScheduledAt.slice(0, 10)}.`);

  lines.push(`Reads this week: ${b.readsThisWeek} (last week ${b.readsLastWeek}).`);
  if (s.month) {
    lines.push(`This month so far: ${s.month.views} reads (previous month total ${s.month.prevViews}), ${s.month.conversions} conversions, organic share ${pct(s.month.organicShare)}.`);
    if (s.month.topPosts.length) {
      lines.push(`Top posts this month: ${s.month.topPosts.map((p) => `"${p.title}" (${p.views})`).join(', ')}.`);
    }
  }

  lines.push(s.gsc
    ? `Google Search (last synced snapshot): ${s.gsc.clicks} clicks from ${s.gsc.impressions} impressions (CTR ${pct(s.gsc.ctr)}), average position ${s.gsc.avgPosition.toFixed(1)}.`
    : s.setup.gscConnected
      ? 'Google Search Console: connected, no impressions recorded yet.'
      : 'Google Search Console: NOT connected (no impressions/clicks data).');

  lines.push(`Setup: autopilot ${s.setup.autoPublish ? 'ON' : 'OFF (review mode)'}, ${s.setup.postsPerWeek} posts/week, canonical base ${s.setup.canonicalBase ?? 'not set'}, custom hostname ${s.setup.customHostname ?? 'not set'}, GA4 ${s.setup.ga4Connected ? 'connected' : 'not connected'}.`);

  return lines.join('\n');
}
