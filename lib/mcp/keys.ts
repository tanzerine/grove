/**
 * MCP API keys — mint, hash, mask, and decide whether one may still be used.
 *
 * The secret is shown to the customer exactly once. Grove stores only
 * sha256(secret) and authenticates by looking that digest up (mcp_keys.key_hash
 * is unique), so there is no candidate row to compare against and no timing
 * side channel to worry about — either the digest exists or it doesn't.
 *
 * Everything here is pure except mintKey(), which is the one place randomness
 * enters. That keeps the whole credential lifecycle unit-testable.
 */
import { createHash, randomBytes } from 'crypto';

/** Human-recognisable prefix — a leaked key is greppable and self-identifying. */
export const KEY_PREFIX = 'gv_mcp_';

/** How much of the secret doubles as the non-secret display id. */
const PREFIX_CHARS = 8;

export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];

export type MintedKey = {
  /** Returned to the customer once, never stored. */
  secret: string;
  /** Stored + displayed: `gv_mcp_` plus the first 8 chars of the random half. */
  prefix: string;
  /** Stored: sha256(secret), lowercase hex. */
  hash: string;
};

/** New credential. 32 random bytes ≈ 256 bits — not guessable, not enumerable. */
export function mintKey(): MintedKey {
  const secret = KEY_PREFIX + randomBytes(32).toString('base64url');
  return { secret, prefix: keyPrefix(secret), hash: hashKey(secret) };
}

export function hashKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** The non-secret half: enough to tell two keys apart in a list, useless alone. */
export function keyPrefix(secret: string): string {
  const body = secret.startsWith(KEY_PREFIX) ? secret.slice(KEY_PREFIX.length) : secret;
  return KEY_PREFIX + body.slice(0, PREFIX_CHARS);
}

/** `gv_mcp_ab12cd34••••••••` — what the dashboard shows after creation. */
export function maskKey(prefix: string): string {
  return `${prefix}${'•'.repeat(12)}`;
}

/**
 * Cheap shape check before touching the database. Rejects the obvious garbage
 * (empty headers, "undefined", a pasted curl example) without a query.
 */
export function looksLikeKey(v: string | null | undefined): boolean {
  if (!v || !v.startsWith(KEY_PREFIX)) return false;
  const body = v.slice(KEY_PREFIX.length);
  return body.length >= 20 && /^[A-Za-z0-9_-]+$/.test(body);
}

/**
 * Pull the credential out of the request headers.
 *
 * `Authorization: Bearer <key>` is what the MCP spec and every client that can
 * set a header use. `x-api-key` is accepted too because a few clients expose
 * only that field, and refusing it would cost the customer an afternoon for no
 * security gain — it is the same secret over the same TLS.
 */
export function bearerToken(headers: {
  authorization?: string | null;
  apiKey?: string | null;
}): string | null {
  const auth = (headers.authorization ?? '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const raw = (headers.apiKey ?? '').trim();
  return raw ? raw : null;
}

export type KeyRecord = {
  revoked_at?: string | null;
  expires_at?: string | null;
  scopes?: string[] | null;
};

export type KeyState = 'active' | 'revoked' | 'expired';

/**
 * Revocation wins over expiry: a key the customer explicitly killed should read
 * as "Revoked" in the dashboard even after its natural expiry passes, because
 * that is the fact they need to see when auditing who had access.
 */
export function keyState(row: KeyRecord, now: Date = new Date()): KeyState {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function isUsable(row: KeyRecord, now: Date = new Date()): boolean {
  return keyState(row, now) === 'active';
}

/**
 * Scopes are additive and 'read' is implicit — a key with no usable scopes at
 * all would authenticate and then fail every call, which is worse than useless.
 */
export function normalizeScopes(input: unknown): Scope[] {
  const raw = Array.isArray(input) ? input : [];
  const out = SCOPES.filter((s) => raw.includes(s));
  return out.includes('read') ? out : (['read', ...out] as Scope[]);
}

export function hasScope(row: KeyRecord, scope: Scope): boolean {
  return normalizeScopes(row.scopes).includes(scope);
}
