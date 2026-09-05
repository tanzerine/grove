/**
 * The token endpoint — authorization codes and refresh tokens in, access
 * tokens out.
 *
 * THE CODE IS BURNED BEFORE IT IS TRUSTED. `consumed_at` is set with a
 * conditional update that only matches a row still holding NULL, so two
 * simultaneous exchanges of the same code cannot both win: the loser's update
 * affects nothing and it is refused. Checking-then-updating would let a
 * replayed code mint a second token in the gap between the two statements, and
 * that gap is exactly what an attacker who lifted a code from a browser history
 * or a proxy log is racing for.
 *
 * Errors follow RFC 6749 §5.2 shapes because clients branch on them; the HTTP
 * status alone tells a client nothing it can act on.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appBase } from '@/lib/seo';
import { mcpResourceUri } from '@/lib/mcp/oauth-metadata';
import {
  ACCESS_PREFIX, ACCESS_TTL_MS, REFRESH_PREFIX, REFRESH_TTL_MS,
  mintOpaque, normalizeResource, scopeString, sha256, verifyPkce,
} from '@/lib/mcp/oauth';

export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  // A token response must never sit in a cache, anyone's.
  'cache-control': 'no-store',
  pragma: 'no-cache',
};

function fail(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: CORS });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return fail('invalid_request', 'Send application/x-www-form-urlencoded.');
  const f = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' && v ? v : '';
  };

  const grant = f('grant_type');
  if (grant === 'authorization_code') return exchangeCode(f);
  if (grant === 'refresh_token') return refresh(f);
  return fail('unsupported_grant_type', 'Supported: authorization_code, refresh_token.');
}

async function exchangeCode(f: (k: string) => string) {
  const code = f('code');
  const verifier = f('code_verifier');
  const clientId = f('client_id');
  const redirectUri = f('redirect_uri');

  if (!code || !verifier || !clientId) {
    return fail('invalid_request', 'code, code_verifier and client_id are all required.');
  }

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from('oauth_codes')
    .select('code_hash,client_id,user_id,redirect_uri,code_challenge,code_challenge_method,scopes,resource,expires_at,consumed_at')
    .eq('code_hash', sha256(code))
    .maybeSingle();

  if (error) return fail('server_error', 'Could not verify that code right now. Retry shortly.', 503);
  // One message for "no such code", "already used" and "expired". Which of the
  // three it was is information an attacker holding a stolen code would like,
  // and information the legitimate client cannot act on differently anyway.
  if (!row) return fail('invalid_grant', 'That authorization code is not valid.');
  if (row.consumed_at) return fail('invalid_grant', 'That authorization code is not valid.');
  if (new Date(row.expires_at).getTime() <= Date.now()) return fail('invalid_grant', 'That authorization code is not valid.');

  // The code belongs to the client it was issued to, and comes back to the
  // callback it was issued for.
  if (row.client_id !== clientId) return fail('invalid_grant', 'That authorization code is not valid.');
  if (redirectUri && redirectUri !== row.redirect_uri) {
    return fail('invalid_grant', 'redirect_uri does not match the one the code was issued for.');
  }

  // PKCE. For a public client this is the whole proof that the party redeeming
  // the code is the party that started the flow.
  if (!verifyPkce(verifier, row.code_challenge, row.code_challenge_method)) {
    return fail('invalid_grant', 'code_verifier does not match the challenge.');
  }

  // Burn it. `is('consumed_at', null)` makes this the atomic step: a second
  // exchange racing this one updates zero rows and is refused below.
  const { data: burned, error: burnErr } = await admin
    .from('oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code_hash', row.code_hash)
    .is('consumed_at', null)
    .select('code_hash');
  if (burnErr) return fail('server_error', 'Could not complete the exchange. Retry shortly.', 503);
  if (!burned?.length) return fail('invalid_grant', 'That authorization code is not valid.');

  return issue(row.user_id, row.client_id, row.scopes as string[], row.resource);
}

async function refresh(f: (k: string) => string) {
  const token = f('refresh_token');
  const clientId = f('client_id');
  if (!token) return fail('invalid_request', 'refresh_token is required.');

  const admin = supabaseAdmin();
  const { data: row, error } = await admin
    .from('oauth_tokens')
    .select('id,client_id,user_id,scopes,resource,revoked_at,refresh_expires_at')
    .eq('refresh_hash', sha256(token))
    .maybeSingle();

  if (error) return fail('server_error', 'Could not verify that token right now. Retry shortly.', 503);
  if (!row || row.revoked_at) return fail('invalid_grant', 'That refresh token is not valid.');
  if (clientId && row.client_id !== clientId) return fail('invalid_grant', 'That refresh token is not valid.');
  if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() <= Date.now()) {
    return fail('invalid_grant', 'That refresh token is not valid.');
  }

  // Rotation: the old row is revoked and a fresh pair issued. A refresh token
  // that keeps working after use is a credential with no expiry that nobody
  // notices has been copied.
  await admin.from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
  return issue(row.user_id, row.client_id, row.scopes as string[], row.resource);
}

async function issue(userId: string, clientId: string, scopes: string[], resource: string) {
  // Never mint for an audience this deployment does not serve, even from a row
  // that already exists — a stored resource is only as trustworthy as the day
  // it was written.
  if (normalizeResource(resource) !== normalizeResource(mcpResourceUri(appBase()))) {
    return fail('invalid_target', 'That grant was issued for a different resource.');
  }

  const access = mintOpaque(ACCESS_PREFIX);
  const refreshToken = mintOpaque(REFRESH_PREFIX);
  const now = Date.now();

  const { error } = await supabaseAdmin().from('oauth_tokens').insert({
    token_hash: access.hash,
    refresh_hash: refreshToken.hash,
    client_id: clientId,
    user_id: userId,
    scopes,
    resource,
    expires_at: new Date(now + ACCESS_TTL_MS).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
  });
  if (error) return fail('server_error', 'Could not issue a token. Retry shortly.', 503);

  return NextResponse.json(
    {
      access_token: access.secret,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refreshToken.secret,
      scope: scopeString(scopes as any),
    },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
