import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { buildAuthUrl, isConfigured } from '@/lib/search-console/client';
import { randomBytes } from 'crypto';

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' };

// Close the connect popup with an error rather than rendering the dashboard
// inside a tiny window. Mirrors the social connect route's popupError.
function popupError(error: string) {
  const msg = JSON.stringify({ source: 'grove-oauth', platform: 'gsc', error });
  const redirect = JSON.stringify(`/dashboard/analytics?error=${error}`);
  const html = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:28px;color:#555">
You can close this window.
<script>(function(){try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${msg},window.location.origin);window.close();return;}}catch(e){}window.location.replace(${redirect});})();</script>
</body>`;
  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));
  if (!isConfigured()) return popupError('not_configured');

  const state = randomBytes(16).toString('hex');
  const jar = await cookies();
  jar.set('gsc_state', state, cookieOpts);

  return NextResponse.redirect(buildAuthUrl(state));
}
