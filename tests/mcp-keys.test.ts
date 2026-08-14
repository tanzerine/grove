/**
 * MCP API keys.
 *
 * The contract worth pinning is not "hashing works" — it's that nothing in
 * this module ever produces a path where the token is recoverable from what
 * grove stores, and that a token can't arrive from somewhere it shouldn't.
 * Both are one-line mistakes: returning the token from mintKey's prefix,
 * or reading the key off a query string, where it would survive in server
 * logs, browser history and every URL a customer pastes into a chat.
 */
import { describe, it, expect } from 'vitest';
import { mintKey, hashKey, isKeyShaped, tokenFromHeaders, maskKey, hashesEqual, KEY_PREFIX } from '@/lib/mcp/keys';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

describe('mintKey', () => {
  it('mints an identifiable token and stores only its hash', () => {
    const k = mintKey();
    expect(k.token.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.token_hash).toBe(hashKey(k.token));
    expect(k.token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The stored hash must not be the token, and must not contain it.
    expect(k.token_hash).not.toContain(k.token.slice(KEY_PREFIX.length));
  });

  it('keeps a display stub short enough to be useless as a credential', () => {
    const k = mintKey();
    expect(k.token.startsWith(k.token_prefix)).toBe(true);
    // Six characters of a 256-bit secret identifies a key in a list and
    // guesses nothing.
    expect(k.token_prefix).toHaveLength(KEY_PREFIX.length + 6);
    expect(k.token.length).toBeGreaterThan(k.token_prefix.length + 20);
  });

  it('is random — two mints never collide', () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintKey().token));
    expect(seen.size).toBe(50);
  });

  it('takes its randomness from the caller, so a test can pin it', () => {
    const fixed = mintKey(() => Buffer.alloc(32, 7));
    expect(fixed.token).toBe(mintKey(() => Buffer.alloc(32, 7)).token);
  });
});

describe('hashKey', () => {
  it('is stable and ignores surrounding whitespace', () => {
    // A key pasted out of a config file arrives with a trailing newline more
    // often than not; that must not read as a different key.
    expect(hashKey('grove_mcp_abc')).toBe(hashKey('  grove_mcp_abc\n'));
    expect(hashKey('grove_mcp_abc')).not.toBe(hashKey('grove_mcp_abd'));
  });
});

describe('isKeyShaped', () => {
  it('accepts a real token', () => {
    expect(isKeyShaped(mintKey().token)).toBe(true);
  });

  it('rejects what an unconfigured client actually sends', () => {
    // These are the literal values that show up when a customer's config has
    // an unresolved variable in it. None should cost a database round-trip.
    for (const bad of ['', null, undefined, 'undefined', 'null', 'Bearer', 'grove_mcp_', `${KEY_PREFIX}short`, 'sk-live-1234567890abcdef']) {
      expect(isKeyShaped(bad as string)).toBe(false);
    }
  });

  it('rejects a token with characters base64url never produces', () => {
    expect(isKeyShaped(`${KEY_PREFIX}abcdefghij klmnop`)).toBe(false);
    expect(isKeyShaped(`${KEY_PREFIX}abcdefghij/klmnop`)).toBe(false);
  });
});

describe('tokenFromHeaders', () => {
  it('reads Authorization: Bearer, case-insensitively', () => {
    expect(tokenFromHeaders(headers({ authorization: 'Bearer grove_mcp_x' }))).toBe('grove_mcp_x');
    expect(tokenFromHeaders(headers({ authorization: 'bearer grove_mcp_x' }))).toBe('grove_mcp_x');
    expect(tokenFromHeaders(headers({ authorization: '  Bearer   grove_mcp_x  ' }))).toBe('grove_mcp_x');
  });

  it('falls back to x-api-key, for proxies that eat Authorization', () => {
    expect(tokenFromHeaders(headers({ 'x-api-key': 'grove_mcp_x' }))).toBe('grove_mcp_x');
  });

  it('returns null when there is nothing to read', () => {
    expect(tokenFromHeaders(headers({}))).toBeNull();
    expect(tokenFromHeaders(headers({ authorization: 'Basic abc' }))).toBeNull();
    expect(tokenFromHeaders(headers({ authorization: 'Bearer   ' }))).toBeNull();
  });
});

describe('maskKey', () => {
  it('takes the prefix, never the token', () => {
    const k = mintKey();
    const masked = maskKey(k.token_prefix);
    expect(masked.startsWith(k.token_prefix)).toBe(true);
    expect(masked).not.toBe(k.token);
    expect(k.token.includes(masked)).toBe(false);
  });
});

describe('hashesEqual', () => {
  it('compares equal-length digests and refuses mismatched lengths', () => {
    const h = hashKey('grove_mcp_a');
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, hashKey('grove_mcp_b'))).toBe(false);
    expect(hashesEqual(h, h.slice(0, 10))).toBe(false);
  });
});
