import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { buildAuthUrl, makePkce, makeState } from '@/lib/social/oauth';
import { getProvider, isConfigured, PLATFORMS, type Platform } from '@/lib/social/providers';

const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 600, path: '/' };

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
    return NextResponse.redirect(new URL('/dashboard/connections?error=not_configured', req.url));
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
