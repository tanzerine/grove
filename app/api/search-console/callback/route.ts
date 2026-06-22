import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { exchangeCode, listSites, matchSite, storeConnection } from '@/lib/search-console/client';
import { syncDomain } from '@/lib/search-console/sync';

/**
 * Google OAuth callback. Like the social callback, returns a tiny page that
 * postMessages the result back to the dashboard popup (falling back to a
 * redirect if opened as a full page).
 */
function finish(result: { ok?: boolean; error?: string }) {
  const query = result.ok ? 'gsc=connected' : `error=${result.error ?? 'connect_failed'}`;
  const msg = JSON.stringify({ source: 'grove-oauth', platform: 'gsc', ...result });
  const redirect = JSON.stringify(`/dashboard/analytics?${query}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connecting…</title></head>
<body style="font:14px/1.6 system-ui,sans-serif;color:#555;padding:28px">
Finishing up — you can close this window.
<script>
(function(){
  var msg=${msg};
  try{ if(window.opener && !window.opener.closed){ window.opener.postMessage(msg, window.location.origin); window.close(); return; } }catch(e){}
  window.location.replace(${redirect});
})();
</script>
</body></html>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return finish({ error: oauthErr === 'access_denied' ? 'cancelled' : oauthErr });

  const jar = await cookies();
  const expectedState = jar.get('gsc_state')?.value;
  jar.delete('gsc_state');
  if (!code || !state || !expectedState || state !== expectedState) {
    return finish({ error: 'state_mismatch' });
  }

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return finish({ error: 'session_expired' });

  const { data: domain } = await sb
    .from('domains').select('id, hostname').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return finish({ error: 'no_domain' });

  try {
    const tok = await exchangeCode(code);
    if (!tok.refresh_token) return finish({ error: 'no_refresh_token' });

    // Auto-pick the GSC property that matches this domain.
    const sites = await listSites(tok.access_token);
    const siteUrl = matchSite(sites, domain.hostname);
    if (!siteUrl) return finish({ error: 'no_matching_property' });

    await storeConnection(domain.id, tok.refresh_token, siteUrl);
    // Best-effort first pull so the dashboard isn't empty right after connecting.
    syncDomain(domain.id).catch(() => { /* the cron will retry */ });
  } catch (e: any) {
    console.error('[gsc] connect failed:', e?.message ?? e);
    return finish({ error: 'connect_failed' });
  }

  return finish({ ok: true });
}
