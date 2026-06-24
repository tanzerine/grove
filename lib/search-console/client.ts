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
const SV_BASE = 'https://www.googleapis.com/siteVerification/v1';
// Read performance data + add/verify the property on the owner's behalf, so
// onboarding is one DNS record instead of a trip through the Search Console UI.
const SCOPE = [
  'https://www.googleapis.com/auth/webmasters',
  'https://www.googleapis.com/auth/siteverification',
].join(' ');

/** Bare host used as the Site Verification INET_DOMAIN identifier.
 *  Lowercase first so an uppercase "WWW." is still stripped. */
export function verificationIdentifier(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}
/** Search Console domain-property id for a hostname (covers http/https/www). */
export function domainProperty(hostname: string): string {
  return `sc-domain:${verificationIdentifier(hostname)}`;
}

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
  const host = verificationIdentifier(hostname);
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

/* ───────────────────── Site Verification + property add ──────────────────── */

/**
 * Ask Google for the verification token to place on the domain. For a domain
 * property that's a single DNS TXT record at the apex.
 */
export async function getVerificationToken(accessToken: string, host: string): Promise<string> {
  const r = await fetch(`${SV_BASE}/token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      verificationMethod: 'DNS_TXT',
      site: { type: 'INET_DOMAIN', identifier: verificationIdentifier(host) },
    }),
  });
  if (!r.ok) throw new Error(`gsc getToken failed: ${await r.text()}`);
  const j = await r.json();
  if (!j?.token) throw new Error('gsc getToken returned no token');
  return j.token as string;
}

/**
 * Tell Google to verify the domain now (it checks the TXT record is live).
 * Returns true on success, false when the record isn't found yet (DNS lag) —
 * other failures throw.
 */
export async function verifyDomain(accessToken: string, host: string): Promise<boolean> {
  const r = await fetch(`${SV_BASE}/webResource?verificationMethod=DNS_TXT`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ site: { type: 'INET_DOMAIN', identifier: verificationIdentifier(host) } }),
  });
  if (r.ok) return true;
  // 400 = token not present yet (DNS still propagating) — a soft "try again".
  if (r.status === 400) return false;
  throw new Error(`gsc verify failed: ${await r.text()}`);
}

/** Add a (now-verified) domain property to the user's Search Console. */
export async function addSite(accessToken: string, siteUrl: string): Promise<void> {
  const r = await fetch(`${API_BASE}/sites/${encodeURIComponent(siteUrl)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  // 200/204 = added; 409 = already there — both fine.
  if (!r.ok && r.status !== 409) throw new Error(`gsc sites.add failed: ${await r.text()}`);
}

/* ─────────────────────────── connection storage ─────────────────────────── */

/** Phase 1 (OAuth): store the refresh token. siteUrl is set later, once a
 *  verified property is confirmed — until then the connection is "pending". */
export async function storeConnection(domainId: string, refreshToken: string, siteUrl: string | null) {
  const sb = supabaseAdmin();
  await sb.from('domains').update({
    gsc_refresh_token: encryptToken(refreshToken),
    gsc_site_url: siteUrl,
    gsc_connected_at: new Date().toISOString(),
  }).eq('id', domainId);
}

/** Phase 2: mark which verified property we'll pull data from. */
export async function setSite(domainId: string, siteUrl: string) {
  const sb = supabaseAdmin();
  await sb.from('domains').update({ gsc_site_url: siteUrl }).eq('id', domainId);
}

/** The decrypted refresh token, present whenever OAuth completed (even before
 *  the property is verified). Used by the setup/verify routes. */
export async function loadRefreshToken(domainId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data } = await sb.from('domains').select('gsc_refresh_token').eq('id', domainId).maybeSingle();
  return data?.gsc_refresh_token ? decryptToken(data.gsc_refresh_token) : null;
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
