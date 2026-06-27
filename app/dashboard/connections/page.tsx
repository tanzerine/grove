import { supabaseServer } from '@/lib/supabase/server';
import { PLATFORMS, isConfigured } from '@/lib/social/providers';
import ConnectionsClient, { type PlatformView } from './ConnectionsClient';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains').select('id, auto_social, social_webhook_url, social_webhook_secret').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (!domain) {
    return (
      <>
        <header className="gv-header"><div style={{ fontSize: 16, fontWeight: 700 }}>Social</div></header>
        <div className="gv-body"><p style={{ color: '#9aa096' }}>Connect a domain first.</p></div>
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
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Social</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>cross-post every article to your channels</div>
        </div>
      </header>
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
