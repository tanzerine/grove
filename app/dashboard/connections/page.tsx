import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { PLATFORMS, isConfigured } from '@/lib/social/providers';
import ConnectionsClient, { type PlatformView } from './ConnectionsClient';
import { DashHeader } from '../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Same rule as every other site-scoped page: the switcher decides. Picking the
  // newest domain here meant a two-site account connected social accounts to
  // whichever site they weren't looking at.
  const domain = await getActiveDomain(sb);

  if (!domain) {
    return (
      <>
        <DashHeader title="Social" />
        <div className="gv-body"><p style={{ color: 'var(--gv-dim)' }}>Connect a domain first.</p></div>
      </>
    );
  }

  const { data: conns } = await sb
    .from('social_connections')
    .select('platform, account_handle, connected_at')
    .eq('domain_id', domain.id);

  const byPlatform = new Map((conns ?? []).map((c: any) => [c.platform, c]));
  const platforms: PlatformView[] = PLATFORMS.map((pf) => ({
    id: pf,
    configured: isConfigured(pf),       // env-derived; computed server-side
    connection: byPlatform.get(pf)
      ? { account_handle: byPlatform.get(pf).account_handle, connected_at: byPlatform.get(pf).connected_at }
      : null,
  }));

  return (
    <>
      <DashHeader title="Social" subtitle="cross-post every article to your channels" />
      <div className="gv-body">
        <ConnectionsClient
          domainId={domain.id}
          autoSocial={!!domain.auto_social}
          platforms={platforms}
          webhookUrl={domain.social_webhook_url ?? null}
          webhookSecret={domain.social_webhook_secret ?? null}
        />
      </div>
    </>
  );
}
