import { supabaseServer } from '@/lib/supabase/server';
import { PLATFORMS, isConfigured } from '@/lib/social/providers';
import ConnectionsClient, { type PlatformView } from './ConnectionsClient';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains').select('id, auto_social').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!domain) {
    return <p style={{ marginTop: 40, color: 'var(--clay)' }}>Connect a domain first.</p>;
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

  return <ConnectionsClient domainId={domain.id} autoSocial={!!domain.auto_social} platforms={platforms} />;
}
