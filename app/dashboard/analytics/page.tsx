import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { isConfigured as gscConfigured } from '@/lib/search-console/client';
import { loadAnalytics, loadServiceState, type AnalyticsData } from '@/lib/analytics/dashboard';
import { buildServiceState, type ServiceState } from '@/lib/analytics/service-state';
import AnalyticsDashboard from './AnalyticsDashboard';

export const dynamic = 'force-dynamic';

const NO_DATA: AnalyticsData = {
  live: null, series: null, topContent: null, ranking: null,
  traffic: null, answers: null, funnel: null,
  firstParty: null, readsSeries: null, fpContent: null,
};

/** Everything-off state for the no-domain case (and as a fail-soft fallback). */
function emptyState(configured: boolean): ServiceState {
  return buildServiceState({
    now: new Date(),
    posts: { published: 0, inFlight: 0, inReview: 0, scheduled: 0, failed: 0, nextScheduledAt: null, lastPublishedAt: null },
    gsc: { configured, connected: false, verified: false, syncedAt: null },
    tracking: { lastEventAt: null, events7d: 0 },
    quality: { avgScore: null, evaluated: 0 },
  });
}

export default async function AnalyticsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Active site (cookie-selected) via getActiveDomain — select('*') under the
  // hood, so this stays safe before the gsc_* columns land (missing columns
  // just read as undefined). A null domain is handled inline below.
  const domain = await getActiveDomain(sb);

  const hostname = domain?.hostname ?? 'your site';
  const configured = gscConfigured();

  // Search Console state: "connected" = OAuth token stored; "verified" = a
  // property is wired up and we can pull data. Between them sits one DNS step.
  const connected = !!(domain as any)?.gsc_connected_at;
  const verified = !!(domain as any)?.gsc_site_url;

  const [data, state] = domain
    ? await Promise.all([
        loadAnalytics(sb, domain.id, verified),
        loadServiceState(sb, domain as any, configured).catch(() => emptyState(configured)),
      ])
    : [NO_DATA, emptyState(configured)];

  const syncedAt = (domain as any)?.gsc_synced_at;
  const syncedAgo = syncedAt ? relativeTime(new Date(syncedAt)) : null;

  return (
    <AnalyticsDashboard
      hostname={hostname}
      configured={configured}
      connected={connected}
      verified={verified}
      data={data}
      state={state}
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
