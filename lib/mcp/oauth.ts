/**
 * The pure half of grove's OAuth authorization server.
 *
 * Everything here is a decision that must be identical in two places — the
 * consent page and the token endpoint both validate the same redirect URI, both
 * parse the same scope string — and a drift between them is how this class of
 * flow gets broken. Keeping the decisions in one tested module is the point;
 * the routes hold only the database work.
 *
 * `mintOpaque` is the one impure function, because randomness has to enter
 * somewhere. Everything else takes its inputs as arguments.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { MCP_SCOPES, type McpScope } from './oauth-metadata';
import type { Scope } from './keys';

/* ── credential shapes ─────────────────────────────────────────────────── */

/** Access token. Distinct from `gv_mcp_` so the auth boundary can route on the
 *  shape alone, without a query, and so a leaked token is self-identifying. */
export const ACCESS_PREFIX = 'gvo_';
/** Refresh token — never accepted at /api/mcp, only at the token endpoint. */
export const REFRESH_PREFIX = 'gvr_';
export const CLIENT_PREFIX = 'gvc_';

/**
 * Lifetimes.
 *
 * The access token is deliberately not an hour. An agent runs in a terminal a
 * customer opens every few days, and an hourly expiry means the common
 * experience of this feature is a refresh dance — which is the part of OAuth
 * most likely to be subtly wrong and hardest to notice failing. Thirty days,
 * revocable instantly from the database, is the honest trade for a token that
 * reads and writes one account's own blog posts.
 */
export const ACCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
/** OAuth 2.1 caps authorization codes at ten minutes and asks for less. */
export const CODE_TTL_MS = 5 * 60 * 1000;

export type Minted = { secret: string; hash: string };

export function mintOpaque(prefix: string): Minted {
  const secret = prefix + randomBytes(32).toString('base64url');
  return { secret, hash: sha256(secret) };
}

export function sha256(v: string): string {
  return createHash('sha256').update(v, 'utf8').digest('hex');
}

export function looksLikeAccessToken(v: string | null | undefined): boolean {
  return shapedLike(v, ACCESS_PREFIX);
}

export function looksLikeRefreshToken(v: string | null | undefined): boolean {
  return shapedLike(v, REFRESH_PREFIX);
}

function shapedLike(v: string | null | undefined, prefix: string): boolean {
  if (!v || !v.startsWith(prefix)) return false;
  const body = v.slice(prefix.length);
  return body.length >= 20 && /^[A-Za-z0-9_-]+$/.test(body);
}

/* ── PKCE ──────────────────────────────────────────────────────────────── */

/**
 * S256 only.
 *
 * PKCE is the entire proof of identity for a public client — there is no
 * secret — so `plain` would reduce the check to "did you echo back a value an
 * attacker who intercepted the authorization request already has". OAuth 2.1
 * removed it; so does this.
 */
export function verifyPkce(verifier: string, challenge: string, method = 'S256'): boolean {
  if (method !== 'S256') return false;
  // RFC 7636 §4.1: 43–128 characters from the unreserved set.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier, 'ascii').digest('base64url');
  return constantTimeEquals(computed, challenge);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a (harmless,
  // already-public) length leak — the digests compared here are fixed-length.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/* ── redirect URIs ─────────────────────────────────────────────────────── */

/**
 * Which redirect URIs a client may register.
 *
 * The rule that matters: no plaintext HTTP except to the loopback interface.
 * A CLI has nowhere to listen but `http://127.0.0.1:<port>`, and OAuth 2.1
 * carves that out precisely because there is no network hop to intercept. Any
 * other http:// destination would put an authorization code on the wire in
 * clear, and `localhost` resolving somewhere unexpected is a real thing, so the
 * literal loopback addresses are accepted alongside it.
 *
 * Fragments are rejected outright: a fragment on a redirect URI is never
 * meaningful and is a known way to smuggle a second destination past a
 * prefix check.
 */
export function redirectUriValid(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return isLoopback(u.hostname);
  // Custom schemes (myapp://callback) are how native apps come back. Allowed,
  // but they must actually be a scheme and not an accident.
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && u.protocol !== 'javascript:' && u.protocol !== 'data:';
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost';
}

/**
 * Does the requested URI match one this client registered?
 *
 * Exact string match, with one exception required by OAuth 2.1: for loopback
 * redirects the PORT may differ, because a CLI binds whatever port is free at
 * the moment it runs and cannot know it at registration time. Scheme, host and
 * path must still match exactly — the port is the only thing allowed to float,
 * and only on loopback.
 */
export function redirectUriAllowed(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;

  let want: URL;
  try {
    want = new URL(requested);
  } catch {
    return false;
  }
  if (want.protocol !== 'http:' || !isLoopback(want.hostname)) return false;

  return registered.some((r) => {
    try {
      const have = new URL(r);
      return (
        have.protocol === 'http:' &&
        isLoopback(have.hostname) &&
        have.hostname === want.hostname &&
        have.pathname === want.pathname
      );
    } catch {
      return false;
    }
  });
}

/* ── scopes ────────────────────────────────────────────────────────────── */

/**
 * Parse a space-delimited scope string, keeping only what grove issues.
 *
 * Unknown scopes are dropped rather than rejected: a client asking for
 * something grove has never heard of should get the subset that exists, not a
 * failed connection. `posts:read` is always included — a token with no usable
 * scope would authenticate and then fail every call, which is worse than
 * useless.
 */
export function parseScopes(raw: string | null | undefined): McpScope[] {
  const asked = (raw ?? '').split(/\s+/).filter(Boolean);
  const kept = MCP_SCOPES.filter((s) => asked.includes(s));
  return kept.includes('posts:read') ? kept : (['posts:read', ...kept] as McpScope[]);
}

export function scopeString(scopes: McpScope[]): string {
  return scopes.join(' ');
}

/**
 * OAuth scopes → the `Scope` vocabulary every tool already declares.
 *
 * This mapping is why the OAuth work does not reach into the tool layer:
 * `hasScope()`, `TOOLS[].scope` and the handlers stay exactly as they are, and
 * a token arrives at them indistinguishable from a key.
 */
export function toKeyScopes(scopes: McpScope[]): Scope[] {
  const out: Scope[] = ['read'];
  if (scopes.includes('posts:write')) out.push('write');
  return out;
}

/* ── authorization request ─────────────────────────────────────────────── */

export type AuthorizeParams = {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  state: string | null;
  resource: string | null;
};

export type AuthorizeCheck =
  /** Safe to send the user back to the client with an error in the query. */
  | { ok: false; kind: 'redirectable'; error: string; description: string }
  /** The redirect URI itself is untrustworthy, so nothing may be redirected —
   *  sending an error to an unverified URI is an open redirect. Render it. */
  | { ok: false; kind: 'fatal'; error: string; description: string }
  | { ok: true; scopes: McpScope[] };

/**
 * Validate an authorization request against the client that registered.
 *
 * The order is deliberate and is the part that is easy to get wrong: the
 * redirect URI is checked FIRST, and anything wrong with it is fatal rather
 * than redirectable. Every later failure can be reported to the client, because
 * by then we know where "the client" actually is.
 */
export function checkAuthorize(
  params: AuthorizeParams,
  client: { redirect_uris: string[] } | null,
  expectedResource: string,
): AuthorizeCheck {
  if (!client) {
    return { ok: false, kind: 'fatal', error: 'invalid_client', description: 'Unknown client_id. Register before authorizing.' };
  }
  if (!params.redirect_uri || !redirectUriAllowed(client.redirect_uris, params.redirect_uri)) {
    return { ok: false, kind: 'fatal', error: 'invalid_request', description: 'redirect_uri does not match one registered by this client.' };
  }
  if (params.response_type !== 'code') {
    return { ok: false, kind: 'redirectable', error: 'unsupported_response_type', description: 'Only the authorization code flow is supported.' };
  }
  if (params.code_challenge_method !== 'S256') {
    return { ok: false, kind: 'redirectable', error: 'invalid_request', description: 'PKCE is required with code_challenge_method=S256.' };
  }
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(params.code_challenge)) {
    return { ok: false, kind: 'redirectable', error: 'invalid_request', description: 'code_challenge is missing or malformed.' };
  }
  // RFC 8707. A client that asks for a token audience grove does not serve has
  // been misconfigured or misdirected, and issuing anyway would mint a token
  // for somebody else's resource.
  if (params.resource && normalizeResource(params.resource) !== normalizeResource(expectedResource)) {
    return { ok: false, kind: 'redirectable', error: 'invalid_target', description: `This server only issues tokens for ${expectedResource}.` };
  }
  return { ok: true, scopes: parseScopes(params.scope) };
}

/** Trailing slashes are the one difference RFC 8707 tolerates in practice. */
export function normalizeResource(uri: string): string {
  return uri.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Build the redirect back to the client.
 *
 * `iss` is included on success AND on error (RFC 9207): a client that recorded
 * which authorization server it started with can only detect a mix-up attack if
 * every response says who is answering.
 */
export function authorizeRedirect(
  redirectUri: string,
  issuer: string,
  result: { code: string } | { error: string; description?: string },
  state: string | null,
): string {
  const url = new URL(redirectUri);
  if ('code' in result) url.searchParams.set('code', result.code);
  else {
    url.searchParams.set('error', result.error);
    if (result.description) url.searchParams.set('error_description', result.description);
  }
  if (state) url.searchParams.set('state', state);
  url.searchParams.set('iss', issuer);
  return url.toString();
}
