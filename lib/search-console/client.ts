/**
 * Google Search Console — read-only client.
 *
 * Plain `fetch` against Google's OAuth + Search Console REST endpoints (no SDK
 * dependency, mirrors lib/social/oauth.ts). With GOOGLE_CLIENT_ID/SECRET unset,
 * `isConfigured()` is false and the UI shows GSC as "not set up" instead of
 * throwing — same inert-until-configured contract as the social providers.
 *
 * Redirect URI to register in the Google Cloud console:
 *   {NEXT_PUBLIC_APP_URL}/api/search-console/callback
 *
 * Scope: webmasters.readonly — we only ever READ performance data.
 */
import { supabaseAdmin } from '../supabase/admin';
import { encryptToken, decryptToken } from '../social/crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export function isConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

export function redirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return `${base}/api/search-console/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    access_type: 'offline',     // ask for a refresh token
    prompt: 'consent',          // force it even on re-consent so we always get one
    include_granted_scopes: 'true',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number };

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`gsc token exchange failed: ${await r.text()}`);
  return (await r.json()) as TokenResponse;
}

/** Trade a stored refresh token for a fresh, short-lived access token. */
export async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) throw new Error(`gsc token refresh failed: ${await r.text()}`);
  const j = (await r.json()) as TokenResponse;
  if (!j.access_token) throw new Error('gsc token refresh returned no access_token');
  return j.access_token;
}

export type GscSite = { siteUrl: string; permissionLevel: string };

export async function listSites(accessToken: string): Promise<GscSite[]> {
  const r = await fetch(`${API_BASE}/sites`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`gsc sites.list failed: ${await r.text()}`);
  const j = await r.json();
  return (j?.siteEntry ?? []) as GscSite[];
}

/**
 * Pick the GSC property that matches this domain. Prefer a domain property
 * (`sc-domain:host`, covers http/https/www), else any URL-prefix property whose
 * host matches. Only properties the user can actually read are considered.
 */
export function matchSite(sites: GscSite[], hostname: string): string | null {
  const host = hostname.replace(/^www\./, '').toLowerCase();
  const usable = sites.filter((s) => s.permissionLevel !== 'siteUnverifiedUser');
  const domainProp = usable.find((s) => s.siteUrl.toLowerCase() === `sc-domain:${host}`);
  if (domainProp) return domainProp.siteUrl;
  const urlProp = usable.find((s) => {
    try { return new URL(s.siteUrl).hostname.replace(/^www\./, '').toLowerCase() === host; }
    catch { return false; }
  });
  return urlProp?.siteUrl ?? null;
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  opts: { startDate: string; endDate: string; dimensions: string[]; rowLimit?: number },
): Promise<GscRow[]> {
  const r = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions,
        rowLimit: opts.rowLimit ?? 250,
      }),
    },
  );
  if (!r.ok) throw new Error(`gsc searchAnalytics failed: ${await r.text()}`);
  const j = await r.json();
  return (j?.rows ?? []) as GscRow[];
}

/* ─────────────────────────── connection storage ─────────────────────────── */

export async function storeConnection(domainId: string, refreshToken: string, siteUrl: string) {
  const sb = supabaseAdmin();
  await sb.from('domains').update({
    gsc_refresh_token: encryptToken(refreshToken),
    gsc_site_url: siteUrl,
    gsc_connected_at: new Date().toISOString(),
  }).eq('id', domainId);
}

export async function clearConnection(domainId: string) {
  const sb = supabaseAdmin();
  await sb.from('domains').update({
    gsc_refresh_token: null,
    gsc_site_url: null,
    gsc_connected_at: null,
    gsc_synced_at: null,
  }).eq('id', domainId);
}

export type GscConnection = { refreshToken: string; siteUrl: string };

/** Load + decrypt a domain's GSC connection, or null if not connected. */
export async function getConnection(domainId: string): Promise<GscConnection | null> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('domains').select('gsc_refresh_token, gsc_site_url').eq('id', domainId).maybeSingle();
  if (!data?.gsc_refresh_token || !data?.gsc_site_url) return null;
  return { refreshToken: decryptToken(data.gsc_refresh_token), siteUrl: data.gsc_site_url };
}
