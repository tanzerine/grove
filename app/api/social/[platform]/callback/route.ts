import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { exchangeCode, fetchAccount, storeConnection } from '@/lib/social/oauth';
import { PLATFORMS, type Platform } from '@/lib/social/providers';

export async function GET(req: Request, ctx: { params: Promise<{ platform: string }> }) {
  const { platform } = await ctx.params;
  const back = (q: string) => NextResponse.redirect(new URL(`/dashboard/connections?${q}`, req.url));
  if (!PLATFORMS.includes(platform as Platform)) return back('error=unknown_platform');
  const pf = platform as Platform;

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const jar = await cookies();
  const expectedState = jar.get(`social_state_${pf}`)?.value;
  const verifier = jar.get(`social_verifier_${pf}`)?.value;
  // clear one-time cookies regardless of outcome
  jar.delete(`social_state_${pf}`);
  jar.delete(`social_verifier_${pf}`);

  if (!code || !state || !expectedState || state !== expectedState) return back('error=state_mismatch');

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.url));

  const { data: domain } = await sb
    .from('domains').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return back('error=no_domain');

  try {
    const tok = await exchangeCode(pf, code, verifier);
    const account = await fetchAccount(pf, tok.access_token);
    await storeConnection(domain.id, pf, tok, account);
  } catch (e: any) {
    console.error(`[social ${pf}] connect failed:`, e?.message ?? e);
    return back(`error=connect_failed&platform=${pf}`);
  }

  return back(`connected=${pf}`);
}
