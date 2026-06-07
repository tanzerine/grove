/**
 * OAuth flow helpers + connection storage. Pure-ish functions; the route
 * handlers own cookies (state + PKCE verifier) and redirects.
 */
import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '../supabase/admin';
import { encryptToken, decryptToken } from './crypto';
import { getProvider, redirectUri, type Platform } from './providers';

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export type Account = { id?: string; handle?: string };

export type Connection = {
  platform: Platform;
  account_handle: string | null;
  account_id: string | null;
  access_token: string;          // decrypted
  refresh_token: string | null;  // decrypted
  expires_at: string | null;
  scopes: string | null;
};

/* ─────────────────────────── PKCE ─────────────────────────── */
export function makePkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
export function makeState() {
  return randomBytes(16).toString('hex');
}

/* ──────────────────────── authorize URL ───────────────────── */
export function buildAuthUrl(platform: Platform, state: string, challenge?: string): string {
  const p = getProvider(platform);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId ?? '',
    redirect_uri: redirectUri(platform),
    scope: p.scopes.join(' '),
    state,
  });
  if (p.usesPKCE && challenge) {
    params.set('code_challenge', challenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${p.authUrl}?${params.toString()}`;
}

/* ──────────────────────── token exchange ──────────────────── */
export async function exchangeCode(platform: Platform, code: string, verifier?: string): Promise<TokenResponse> {
  const p = getProvider(platform);

  // Facebook/Instagram uses a GET token endpoint with query params.
  if (platform === 'instagram') {
    const url = new URL(p.tokenUrl);
    url.searchParams.set('client_id', p.clientId ?? '');
    url.searchParams.set('client_secret', p.clientSecret ?? '');
    url.searchParams.set('redirect_uri', redirectUri(platform));
    url.searchParams.set('code', code);
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) throw new Error(`token exchange failed (${platform}): ${await r.text()}`);
    return (await r.json()) as TokenResponse;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(platform),
    client_id: p.clientId ?? '',
  });
  if (p.usesPKCE && verifier) body.set('code_verifier', verifier);
  if (!p.tokenBasicAuth) body.set('client_secret', p.clientSecret ?? '');

  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (p.tokenBasicAuth) {
    headers.authorization = 'Basic ' + Buffer.from(`${p.clientId}:${p.clientSecret}`).toString('base64');
  }

  const r = await fetch(p.tokenUrl, { method: 'POST', headers, body });
  if (!r.ok) throw new Error(`token exchange failed (${platform}): ${await r.text()}`);
  return (await r.json()) as TokenResponse;
}

/* ──────────────────────── account lookup ──────────────────── */
export async function fetchAccount(platform: Platform, accessToken: string): Promise<Account> {
  try {
    if (platform === 'x') {
      const r = await fetch('https://api.twitter.com/2/users/me', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json();
      return { id: j?.data?.id, handle: j?.data?.username ? `@${j.data.username}` : undefined };
    }
    if (platform === 'linkedin') {
      const r = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json();
      // member URN used as the post author
      return { id: j?.sub ? `urn:li:person:${j.sub}` : undefined, handle: j?.name };
    }
    // instagram: resolve the IG business account behind the user's first page
    const pages = await fetch(
      `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account,name&access_token=${accessToken}`,
    ).then((r) => r.json());
    const page = (pages?.data ?? []).find((p: any) => p.instagram_business_account?.id);
    const igId = page?.instagram_business_account?.id;
    return { id: igId, handle: page?.name };
  } catch {
    return {};
  }
}

/* ──────────────────────── storage ─────────────────────────── */
export async function storeConnection(
  domainId: string, platform: Platform, tok: TokenResponse, account: Account,
) {
  const sb = supabaseAdmin();
  const expires_at = tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null;
  await sb.from('social_connections').upsert({
    domain_id: domainId,
    platform,
    account_handle: account.handle ?? null,
    account_id: account.id ?? null,
    access_token: encryptToken(tok.access_token),
    refresh_token: tok.refresh_token ? encryptToken(tok.refresh_token) : null,
    expires_at,
    scopes: tok.scope ?? null,
    connected_at: new Date().toISOString(),
  }, { onConflict: 'domain_id,platform' });
}

export async function getConnections(domainId: string): Promise<Connection[]> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('social_connections').select('*').eq('domain_id', domainId);
  return (data ?? []).map((row: any) => ({
    platform: row.platform,
    account_handle: row.account_handle,
    account_id: row.account_id,
    access_token: decryptToken(row.access_token),
    refresh_token: row.refresh_token ? decryptToken(row.refresh_token) : null,
    expires_at: row.expires_at,
    scopes: row.scopes,
  }));
}

export async function deleteConnection(domainId: string, platform: Platform) {
  const sb = supabaseAdmin();
  await sb.from('social_connections').delete().eq('domain_id', domainId).eq('platform', platform);
}
