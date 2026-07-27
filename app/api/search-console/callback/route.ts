import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { exchangeCode, storeConnection } from '@/lib/search-console/client';
import { ensurePropertyOnConnect } from '@/lib/search-console/setup';
import { ensureGa4OnConnect } from '@/lib/ga4/setup';
import { captureServer } from '@/lib/analytics/capture-server';

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

    // Phase 1: persist the token. The connection is "pending" until a property
    // is verified — storing siteUrl=null keeps the refresh token for the setup
    // routes to use.
    await storeConnection(domain.id, tok.refresh_token, null);
    // Phase 2: if they already have a matching verified property, wire it up now
    // (the one-click path). Otherwise the dashboard shows the one-DNS-record step.
    await ensurePropertyOnConnect(domain.id, domain.hostname, tok.access_token);
    // Same access token also carries analytics.readonly — resolve + store the
    // GA4 property so whole-site numbers light up without a second connect.
    // Best-effort: never blocks the Search Console connection.
    await ensureGa4OnConnect(domain.id, domain.hostname, tok.access_token);
  } catch (e: any) {
    console.error('[gsc] connect failed:', e?.message ?? e);
    return finish({ error: 'connect_failed' });
  }

  // Captured server-side because the browser only ever sees the popup's
  // postMessage — the connection itself completes here.
  await captureServer(user.id, 'search_console_connected', { domain_id: domain.id });
  return finish({ ok: true });
}
