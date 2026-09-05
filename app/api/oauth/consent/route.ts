/**
 * Where "Allow" lands. Mints the authorization code and sends the browser back
 * to the client.
 *
 * TWO THINGS DEFEND THIS, AND BOTH MATTER. A forged consent — an attacker's
 * page auto-submitting this form in a logged-in customer's browser — would hand
 * that attacker's client a token for the customer's content, which is the
 * classic way an OAuth consent screen is abused.
 *
 *  1. The Origin header must be grove's own. A cross-site form POST always
 *     carries an Origin, so a request from anywhere else is refused outright.
 *  2. The session cookie must be present, and Supabase sets it SameSite=Lax —
 *     which a browser does not send on a cross-site POST at all. So the forged
 *     request arrives unauthenticated even before the check above runs.
 *
 * Neither is sufficient alone in every browser; together they close it.
 *
 * Every parameter is re-validated with the same `checkAuthorize` the page used.
 * The hidden fields are a transport, never a source of authority.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase } from '@/lib/seo';
import { mcpResourceUri } from '@/lib/mcp/oauth-metadata';
import {
  CODE_TTL_MS, authorizeRedirect, checkAuthorize, mintOpaque, scopeString, type AuthorizeParams,
} from '@/lib/mcp/oauth';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

/** 303 so the browser turns the POST into a GET on the client's callback. */
const seeOther = (url: string) => NextResponse.redirect(url, 303);

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  // A same-origin form POST from a modern browser sends Origin too, so a
  // missing one is only ever a non-browser caller — which has no business here.
  if (!origin || origin.replace(/\/+$/, '') !== appBase()) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Cross-origin consent is refused.' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v ? v : '';
  };

  const params: AuthorizeParams = {
    client_id: field('client_id'),
    redirect_uri: field('redirect_uri'),
    response_type: field('response_type') || 'code',
    code_challenge: field('code_challenge'),
    code_challenge_method: field('code_challenge_method') || 'S256',
    scope: field('scope') || null,
    state: field('state') || null,
    resource: field('resource') || null,
  };

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'access_denied', error_description: 'Not signed in.' }, { status: 401 });
  }

  const limited = await enforceRateLimit(`oauth:${user.id}`, LIMITS.mcp);
  if (limited) return limited;

  const admin = supabaseAdmin();
  const { data: client } = await admin
    .from('oauth_clients')
    .select('client_id,client_name,redirect_uris')
    .eq('client_id', params.client_id)
    .maybeSingle();

  const check = checkAuthorize(params, client as any, mcpResourceUri(appBase()));
  if (!check.ok) {
    if (check.kind === 'fatal') {
      return NextResponse.json({ error: check.error, error_description: check.description }, { status: 400 });
    }
    return seeOther(authorizeRedirect(params.redirect_uri, appBase(), { error: check.error, description: check.description }, params.state));
  }

  if (field('decision') !== 'allow') {
    return seeOther(authorizeRedirect(params.redirect_uri, appBase(), { error: 'access_denied', description: 'The account owner declined.' }, params.state));
  }

  const code = mintOpaque('gvac_');
  const { error } = await admin.from('oauth_codes').insert({
    code_hash: code.hash,
    client_id: params.client_id,
    user_id: user.id,
    // Stored so the token exchange can insist on the same one. A code issued
    // for one callback must not be redeemable from another.
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: 'S256',
    scopes: check.scopes,
    resource: mcpResourceUri(appBase()),
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });

  if (error) {
    return seeOther(authorizeRedirect(params.redirect_uri, appBase(), { error: 'server_error', description: 'Could not issue a code. Try again.' }, params.state));
  }

  await admin.from('oauth_clients').update({ last_used_at: new Date().toISOString() }).eq('client_id', params.client_id);

  // `scope` is echoed so a client can see it got less than it asked for without
  // waiting for a tool call to fail.
  const url = new URL(authorizeRedirect(params.redirect_uri, appBase(), { code: code.secret }, params.state));
  url.searchParams.set('scope', scopeString(check.scopes));
  return seeOther(url.toString());
}
