/**
 * MCP API keys — minting, hashing, display, and reading one off a request.
 *
 * Pure and dependency-free apart from node:crypto, so the whole credential
 * story is unit-testable without a database or a request.
 *
 * The contract in one line: grove stores `sha256(token)` and nothing else, so
 * the only moment the token exists in readable form is the response to the
 * mint call. Everything downstream — the dashboard list, the audit row, a
 * database dump — carries the hash and the display stub.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Every token starts with this, so a key found in a log or a config file is
 *  identifiable at a glance (and greppable by secret scanners). */
export const KEY_PREFIX = 'grove_mcp_';

/** Bytes of entropy in the secret half. 32 bytes = 256 bits, base64url'd. */
const SECRET_BYTES = 32;

/** How much of the token the dashboard is allowed to remember, verbatim. */
const PREFIX_KEEP = KEY_PREFIX.length + 6;

export type MintedKey = {
  /** The secret. Returned to the owner ONCE, never stored. */
  token: string;
  /** What goes in mcp_keys.token_hash. */
  token_hash: string;
  /** What goes in mcp_keys.token_prefix — safe to display forever. */
  token_prefix: string;
};

/**
 * Mint a key. `random` is injectable so tests can pin the bytes; production
 * always uses crypto.randomBytes.
 */
export function mintKey(random: (n: number) => Buffer = randomBytes): MintedKey {
  const token = KEY_PREFIX + random(SECRET_BYTES).toString('base64url');
  return { token, token_hash: hashKey(token), token_prefix: token.slice(0, PREFIX_KEEP) };
}

/** SHA-256 (hex) of a token — the value stored and looked up. */
export function hashKey(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

/**
 * Shape check before touching the database. A malformed value can never match
 * a stored hash anyway, so this is purely about not spending a query on
 * "Bearer undefined" — which is what an unconfigured client sends.
 */
export function isKeyShaped(token: string | null | undefined): boolean {
  if (!token) return false;
  const rest = token.startsWith(KEY_PREFIX) ? token.slice(KEY_PREFIX.length) : null;
  return rest !== null && rest.length >= 16 && /^[A-Za-z0-9_-]+$/.test(rest);
}

/**
 * Pull the token off a request.
 *
 * `Authorization: Bearer <token>` is the MCP norm and what every client's
 * `headers` config produces. `x-api-key` is accepted too because some hosts
 * strip or rewrite Authorization on the way through a proxy, and a customer
 * hitting that has no way to tell from the 401 what went wrong.
 *
 * Never read from the query string: MCP endpoints get pasted into configs,
 * chat messages and CI logs, and a token in a URL survives in all three.
 */
export function tokenFromHeaders(headers: {
  get(name: string): string | null;
}): string | null {
  const auth = headers.get('authorization') ?? '';
  const m = /^bearer\s+(.+)$/i.exec(auth.trim());
  const raw = (m ? m[1] : headers.get('x-api-key') ?? '').trim();
  return raw || null;
}

/**
 * Display form for a key the owner already has: the stored prefix plus an
 * ellipsis. Deliberately takes the PREFIX, not a token — a function that
 * accepts the secret is a function someone will hand the secret to.
 */
export function maskKey(tokenPrefix: string): string {
  return `${tokenPrefix}${'…'}`;
}

/**
 * Constant-time compare for two hex digests. Authentication looks keys up by
 * hash (an indexed equality with no candidate set, so no timing signal), but
 * anything that ever compares two hashes in JS should not short-circuit.
 */
export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
