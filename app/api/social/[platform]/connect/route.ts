import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { buildAuthUrl, makePkce, makeState } from '@/lib/social/oauth';
import { getProvider, isConfigured, PLATFORMS, type Platform } from '@/lib/social/providers';

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' };

// Mirror the callback's popup-aware response for the rare pre-redirect error.
function popupError(platform: string, error: string) {
  const msg = JSON.stringify({ source: 'grove-oauth', platform, error });
  const redirect = JSON.stringify(`/dashboard/connections?error=${error}&platform=${platform}`);
  const html = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:28px;color:#555">
You can close this window.
<script>(function(){try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${msg},window.location.origin);window.close();return;}}catch(e){}window.location.replace(${redirect});})();</script>
</body>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  if (!PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: 'unknown platform' }, { status: 400 });
  }
  const pf = platform as Platform;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  if (!isConfigured(pf)) {
    // Reached inside the connect popup — close it with an error rather than
    // rendering the whole dashboard in a tiny window.
    return popupError(pf, 'not_configured');
  }

  const state = makeState();
  const jar = await cookies();
  jar.set(`social_state_${pf}`, state, cookieOpts);

  let challenge: string | undefined;
  if (getProvider(pf).usesPKCE) {
    const pkce = makePkce();
    challenge = pkce.challenge;
    jar.set(`social_verifier_${pf}`, pkce.verifier, cookieOpts);
  }

  return NextResponse.redirect(buildAuthUrl(pf, state, challenge));
}
