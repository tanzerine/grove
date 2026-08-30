import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { PLATFORMS, isConfigured } from '@/lib/social/providers';
import { connectionHealth, latestChannelErrors } from '@/lib/social/health';
import ConnectionsClient, { type PlatformView } from './ConnectionsClient';
import { DashHeader } from '../gv-chrome';
import { getT } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

export default async function ConnectionsPage() {
  const t = await getT();
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
        <DashHeader title={t('Social')} />
        <div className="gv-body"><p style={{ color: 'var(--gv-dim)' }}>{t('Connect a domain first.')}</p></div>
      </>
    );
  }

  // expires_at and refresh_token drive connection HEALTH — without them a dead
  // token rendered exactly like a live one ("Connected as @handle") forever,
  // which is how cross-posting stops silently. refresh_token is only ever read
  // as a boolean here: whether grove can renew this connection unattended. The
  // token itself is encrypted and must never reach the browser.
  const { data: conns } = await sb
    .from('social_connections')
    .select('platform, account_handle, connected_at, expires_at, refresh_token')
    .eq('domain_id', domain.id);

  // The other half of the signal: a revoked refresh token has no expiry to
  // inspect, so the only evidence is the post that failed. Recent published
  // posts, newest first — latestChannelErrors lets a later success clear an
  // earlier failure so the badge can't stick after a reconnect.
  const { data: recentPosts } = await sb
    .from('posts')
    .select('social_published')
    .eq('domain_id', domain.id)
    .eq('status', 'published')
    .not('social_published', 'is', null)
    .order('published_at', { ascending: false })
    .limit(20);
  const channelErrors = latestChannelErrors((recentPosts ?? []) as any[]);

  const byPlatform = new Map((conns ?? []).map((c: any) => [c.platform, c]));
  const platforms: PlatformView[] = PLATFORMS.map((pf) => {
    const c = byPlatform.get(pf);
    return {
      id: pf,
      configured: isConfigured(pf),       // env-derived; computed server-side
      connection: c
        ? {
            account_handle: c.account_handle,
            connected_at: c.connected_at,
            health: connectionHealth({
              expiresAt: c.expires_at,
              canRefresh: !!c.refresh_token,
              lastError: channelErrors[pf] ?? null,
            }),
          }
        : null,
    };
  });

  return (
    <>
      <DashHeader title={t('Social')} subtitle={t('cross-post every article to your channels')} />
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
