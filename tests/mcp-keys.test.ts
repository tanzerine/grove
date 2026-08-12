/**
 * The credential lifecycle for the MCP content API.
 *
 * This is the whole security boundary of the feature: /api/mcp is a public
 * endpoint that hands over a customer's unpublished drafts and lets a caller
 * repoint their canonical URLs. Everything that decides "may this request do
 * that" is in lib/mcp/keys, so it is pinned here rather than left to the route.
 */
import { describe, it, expect } from 'vitest';
import {
  KEY_PREFIX, bearerToken, hashKey, hasScope, isUsable, keyPrefix, keyState,
  looksLikeKey, maskKey, mintKey, normalizeScopes,
} from '@/lib/mcp/keys';

describe('mintKey', () => {
  it('mints a self-identifying, high-entropy secret', () => {
    const k = mintKey();
    expect(k.secret.startsWith(KEY_PREFIX)).toBe(true);
    // 32 random bytes in base64url — a leaked key is greppable, and guessing
    // one is not a strategy.
    expect(k.secret.length).toBeGreaterThan(KEY_PREFIX.length + 40);
    expect(looksLikeKey(k.secret)).toBe(true);
  });

  it('never repeats', () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintKey().secret));
    expect(seen.size).toBe(200);
  });

  it('stores the digest, and the digest cannot stand in for the secret', () => {
    const k = mintKey();
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).toBe(hashKey(k.secret));
    // The row holds the hash. If that value were itself accepted at the door,
    // a database dump would be a set of working credentials.
    expect(looksLikeKey(k.hash)).toBe(false);
  });

  it('shows a prefix that identifies the key but cannot authenticate it', () => {
    const k = mintKey();
    expect(k.prefix.startsWith(KEY_PREFIX)).toBe(true);
    expect(k.secret.startsWith(k.prefix)).toBe(true);
    expect(k.prefix.length).toBeLessThan(k.secret.length);
    expect(hashKey(k.prefix)).not.toBe(k.hash);
    expect(maskKey(k.prefix).startsWith(k.prefix)).toBe(true);
  });
});

describe('looksLikeKey', () => {
  it('rejects the junk that would otherwise cost a database round trip', () => {
    for (const v of ['', null, undefined, 'undefined', 'Bearer', 'gv_mcp_', 'gv_mcp_short', 'sk-live-1234567890123456789012']) {
      expect(looksLikeKey(v as any)).toBe(false);
    }
  });

  it('rejects a key carrying characters base64url never produces', () => {
    // Anything that survived a bad copy-paste (quotes, spaces, a trailing
    // newline) is not a key, and must not reach the query.
    expect(looksLikeKey(`${KEY_PREFIX}abcdefghij klmnopqrstuvwxyz`)).toBe(false);
    expect(looksLikeKey(`${KEY_PREFIX}abcdefghijklmnopqrstuvwxyz'`)).toBe(false);
  });
});

describe('bearerToken', () => {
  it('reads the Authorization header, case-insensitively on the scheme', () => {
    expect(bearerToken({ authorization: 'Bearer gv_mcp_abc' })).toBe('gv_mcp_abc');
    expect(bearerToken({ authorization: 'bearer gv_mcp_abc' })).toBe('gv_mcp_abc');
    expect(bearerToken({ authorization: '  Bearer   gv_mcp_abc  ' })).toBe('gv_mcp_abc');
  });

  it('falls back to x-api-key for clients that can only set that field', () => {
    expect(bearerToken({ authorization: null, apiKey: 'gv_mcp_abc' })).toBe('gv_mcp_abc');
  });

  it('prefers Authorization when both are present', () => {
    expect(bearerToken({ authorization: 'Bearer first', apiKey: 'second' })).toBe('first');
  });

  it('is null when there is nothing to read', () => {
    expect(bearerToken({})).toBeNull();
    expect(bearerToken({ authorization: '', apiKey: '  ' })).toBeNull();
  });
});

describe('keyState', () => {
  const now = new Date('2026-08-12T00:00:00Z');

  it('is active with no revocation and no expiry', () => {
    expect(keyState({}, now)).toBe('active');
    expect(isUsable({}, now)).toBe(true);
  });

  it('expires exactly at the boundary, not a moment later', () => {
    expect(keyState({ expires_at: '2026-08-12T00:00:00Z' }, now)).toBe('expired');
    expect(keyState({ expires_at: '2026-08-12T00:00:01Z' }, now)).toBe('active');
  });

  it('reports revoked even after the expiry has also passed', () => {
    // The dashboard is an audit surface: "revoked" is the fact the owner needs
    // when working out who had access, and it must not be overwritten by the
    // clock rolling past a natural expiry.
    const row = { revoked_at: '2026-01-01T00:00:00Z', expires_at: '2026-02-01T00:00:00Z' };
    expect(keyState(row, now)).toBe('revoked');
    expect(isUsable(row, now)).toBe(false);
  });
});

describe('scopes', () => {
  it('always grants read — a key with no usable scope would authenticate and then fail everything', () => {
    expect(normalizeScopes([])).toEqual(['read']);
    expect(normalizeScopes(null)).toEqual(['read']);
    expect(normalizeScopes(['write'])).toEqual(['read', 'write']);
  });

  it('drops anything not in the vocabulary', () => {
    expect(normalizeScopes(['read', 'admin', 'delete', 'write'])).toEqual(['read', 'write']);
  });

  it('gates write behind an explicit grant', () => {
    expect(hasScope({ scopes: ['read'] }, 'write')).toBe(false);
    expect(hasScope({ scopes: ['read', 'write'] }, 'write')).toBe(true);
    expect(hasScope({ scopes: ['read'] }, 'read')).toBe(true);
  });
});
