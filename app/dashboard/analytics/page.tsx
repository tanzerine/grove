import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { isConfigured as gscConfigured } from '@/lib/search-console/client';
import { loadAnalytics, type AnalyticsData } from '@/lib/analytics/dashboard';
import AnalyticsDashboard from './AnalyticsDashboard';

export const dynamic = 'force-dynamic';

const NO_DATA: AnalyticsData = {
  live: null, series: null, articles: null, ranking: null,
  traffic: null, answers: null, funnel: null,
};

export default async function AnalyticsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Active site (cookie-selected) via getActiveDomain — select('*') under the
  // hood, so this stays safe before the gsc_* columns land (missing columns
  // just read as undefined). A null domain is handled inline below.
  const domain = await getActiveDomain(sb);

  const hostname = domain?.hostname ?? 'your site';

  // Search Console state: "connected" = OAuth token stored; "verified" = a
  // property is wired up and we can pull data. Between them sits one DNS step.
  const connected = !!(domain as any)?.gsc_connected_at;
  const verified = !!(domain as any)?.gsc_site_url;

  const data = domain ? await loadAnalytics(sb, domain.id, verified) : NO_DATA;

  const syncedAt = (domain as any)?.gsc_synced_at;
  const syncedAgo = syncedAt ? relativeTime(new Date(syncedAt)) : 'just now';

  return (
    <AnalyticsDashboard
      hostname={hostname}
      configured={gscConfigured()}
      connected={connected}
      verified={verified}
      data={data}
      syncedAgo={syncedAgo}
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
