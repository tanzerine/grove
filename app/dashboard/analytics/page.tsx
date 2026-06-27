import { supabaseServer } from '@/lib/supabase/server';
import { isConfigured as gscConfigured } from '@/lib/search-console/client';
import { latestSnapshot } from '@/lib/search-console/sync';
import { summarize as gscSummarize, type MetricRow } from '@/lib/search-console/insights';
import AnalyticsDashboard, { type LiveData } from './AnalyticsDashboard';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // select('*') (not an explicit column list) so this stays safe to deploy
  // before the gsc_* columns land — missing columns just read as undefined.
  const { data: domain } = await sb
    .from('domains').select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const hostname = domain?.hostname ?? 'your site';

  // Search Console state: "connected" = OAuth token stored; "verified" = a
  // property is wired up and we can pull data. Between them sits one DNS step.
  const connected = !!(domain as any)?.gsc_connected_at;
  const verified = !!(domain as any)?.gsc_site_url;

  let live: LiveData = null;
  let syncedAgo = '';
  if (domain && verified) {
    try {
      const snap = await latestSnapshot(domain.id);
      if (snap.pages.length || snap.queries.length) {
        const toRow = (r: any): MetricRow => ({ key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position, post_id: r.post_id ?? null });
        const v = gscSummarize(snap.pages.map(toRow), snap.queries.map(toRow));
        if (v.impressions > 0) {
          live = { clicks: v.clicks, impressions: v.impressions, ctr: v.ctr, avgPosition: v.avgPosition, queryCount: v.queryCount };
        }
      }
      const syncedAt = (domain as any).gsc_synced_at;
      if (syncedAt) syncedAgo = relativeTime(new Date(syncedAt));
    } catch { /* optional — fall back to the sample view */ }
  }

  return (
    <AnalyticsDashboard
      hostname={hostname}
      configured={gscConfigured()}
      connected={connected}
      verified={verified}
      live={live}
      syncedAgo={syncedAgo || 'just now'}
    />
  );
}

function relativeTime(d: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
