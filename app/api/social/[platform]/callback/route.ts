import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { exchangeCode, fetchAccount, storeConnection } from '@/lib/social/oauth';
import { PLATFORMS, type Platform } from '@/lib/social/providers';

/**
 * OAuth callback. Returns a tiny HTML page that — when opened in the connect
 * popup — postMessages the result to the dashboard and closes itself. If the
 * page was reached as a full-page navigation (popup blocked, or opened
 * directly), it falls back to a normal redirect back to the connections page.
 */
function finish(result: { platform?: string; ok?: boolean; error?: string }) {
  const query = result.ok
    ? `connected=${result.platform}`
    : `error=${result.error ?? 'connect_failed'}${result.platform ? `&platform=${result.platform}` : ''}`;
  const msg = JSON.stringify({ source: 'grove-oauth', ...result });
  const redirect = JSON.stringify(`/dashboard/connections?${query}`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connecting…</title></head>
<body style="font:14px/1.6 system-ui,sans-serif;color:#555;padding:28px">
Finishing up — you can close this window.
<script>
(function(){
  var msg=${msg};
  try{
    if(window.opener && !window.opener.closed){
      window.opener.postMessage(msg, window.location.origin);
      window.close();
      return;
    }
  }catch(e){}
  window.location.replace(${redirect});
})();
</script>
</body></html>`;
  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  if (!PLATFORMS.includes(platform as Platform)) return finish({ error: 'unknown_platform' });
  const pf = platform as Platform;

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  // The platform sends ?error=access_denied when the user cancels the consent.
  const oauthErr = url.searchParams.get('error');
  if (oauthErr) return finish({ platform: pf, error: oauthErr === 'access_denied' ? 'cancelled' : oauthErr });

  const jar = await cookies();
  const expectedState = jar.get(`social_state_${pf}`)?.value;
  const verifier = jar.get(`social_verifier_${pf}`)?.value;
  // clear one-time cookies regardless of outcome
  jar.delete(`social_state_${pf}`);
  jar.delete(`social_verifier_${pf}`);

  if (!code || !state || !expectedState || state !== expectedState) {
    return finish({ platform: pf, error: 'state_mismatch' });
  }

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return finish({ platform: pf, error: 'session_expired' });

  const { data: domain } = await sb
    .from('domains').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return finish({ platform: pf, error: 'no_domain' });

  try {
    const tok = await exchangeCode(pf, code, verifier);
    const account = await fetchAccount(pf, tok.access_token);
    await storeConnection(domain.id, pf, tok, account);
  } catch (e: any) {
    console.error(`[social ${pf}] connect failed:`, e?.message ?? e);
    return finish({ platform: pf, error: 'connect_failed' });
  }

  return finish({ platform: pf, ok: true });
}
