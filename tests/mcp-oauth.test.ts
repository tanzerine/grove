/**
 * The authorization server's decisions.
 *
 * Everything here decides whether a stranger gets a token for somebody else's
 * blog. None of it throws when it is wrong — a too-permissive redirect rule or
 * a PKCE check that accepts the wrong thing produces a flow that works
 * perfectly for the honest client and also works for the attacker, which is why
 * these are unit-tested rather than left to an integration pass.
 */
import { describe, it, expect } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import {
  authorizeRedirect, checkAuthorize, looksLikeAccessToken, mintOpaque, normalizeResource,
  parseScopes, redirectUriAllowed, redirectUriValid, toKeyScopes, verifyPkce, ACCESS_PREFIX,
} from '@/lib/mcp/oauth';

const RESOURCE = 'https://trygroveai.com/api/mcp';
const ISSUER = 'https://trygroveai.com';

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url') };
};

describe('PKCE', () => {
  it('accepts the verifier that produced the challenge', () => {
    const { verifier, challenge } = pkce();
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a different verifier', () => {
    const { challenge } = pkce();
    expect(verifyPkce(randomBytes(32).toString('base64url'), challenge)).toBe(false);
  });

  it('refuses the plain method outright', () => {
    // With no client secret, PKCE is the only proof the party redeeming the
    // code is the one that started the flow. `plain` reduces that to echoing
    // back a value anyone who saw the authorization request already has.
    const { verifier } = pkce();
    expect(verifyPkce(verifier, verifier, 'plain')).toBe(false);
  });

  it('rejects verifiers outside the RFC 7636 length window', () => {
    expect(verifyPkce('tooshort', createHash('sha256').update('tooshort', 'ascii').digest('base64url'))).toBe(false);
  });
});

describe('redirectUriValid', () => {
  it('allows https anywhere and http only on loopback', () => {
    expect(redirectUriValid('https://app.example.com/cb')).toBe(true);
    expect(redirectUriValid('http://127.0.0.1:8080/callback')).toBe(true);
    expect(redirectUriValid('http://localhost:1455/callback')).toBe(true);
    // Plaintext to anywhere else would put an authorization code on the wire.
    expect(redirectUriValid('http://evil.example.com/cb')).toBe(false);
  });

  it('rejects fragments and script-ish schemes', () => {
    expect(redirectUriValid('https://app.example.com/cb#/x')).toBe(false);
    expect(redirectUriValid('javascript:alert(1)')).toBe(false);
    expect(redirectUriValid('data:text/html,x')).toBe(false);
    expect(redirectUriValid('not a url')).toBe(false);
  });

  it('allows a native app custom scheme', () => {
    expect(redirectUriValid('myapp://oauth/callback')).toBe(true);
  });
});

describe('redirectUriAllowed', () => {
  const registered = ['https://app.example.com/cb', 'http://127.0.0.1:8080/callback'];

  it('matches exactly', () => {
    expect(redirectUriAllowed(registered, 'https://app.example.com/cb')).toBe(true);
    expect(redirectUriAllowed(registered, 'https://app.example.com/cb2')).toBe(false);
  });

  it('lets only the loopback PORT float', () => {
    // A CLI binds whatever port is free the moment it runs and cannot know it
    // at registration time; OAuth 2.1 requires this carve-out.
    expect(redirectUriAllowed(registered, 'http://127.0.0.1:54321/callback')).toBe(true);
    // The path is not part of that carve-out.
    expect(redirectUriAllowed(registered, 'http://127.0.0.1:54321/steal')).toBe(false);
    // Nor is the host.
    expect(redirectUriAllowed(registered, 'http://evil.example.com:8080/callback')).toBe(false);
  });

  it('does not let a remote https port float', () => {
    expect(redirectUriAllowed(registered, 'https://app.example.com:9999/cb')).toBe(false);
  });
});

describe('scopes', () => {
  it('always keeps read, and drops what grove does not issue', () => {
    expect(parseScopes('posts:read posts:write')).toEqual(['posts:read', 'posts:write']);
    // A token with no usable scope would authenticate and then fail every call.
    expect(parseScopes(null)).toEqual(['posts:read']);
    expect(parseScopes('billing:admin offline_access')).toEqual(['posts:read']);
    expect(parseScopes('posts:write')).toEqual(['posts:read', 'posts:write']);
  });

  it('maps onto the vocabulary the tools already declare', () => {
    // This mapping is why the OAuth work never reaches into the tool layer.
    expect(toKeyScopes(['posts:read'])).toEqual(['read']);
    expect(toKeyScopes(['posts:read', 'posts:write'])).toEqual(['read', 'write']);
  });
});

describe('checkAuthorize', () => {
  const client = { redirect_uris: ['https://app.example.com/cb'] };
  const base = {
    client_id: 'gvc_x',
    redirect_uri: 'https://app.example.com/cb',
    response_type: 'code',
    code_challenge: pkce().challenge,
    code_challenge_method: 'S256',
    scope: 'posts:read posts:write',
    state: 'st',
    resource: RESOURCE,
  };

  it('passes a well-formed request', () => {
    const r = checkAuthorize(base, client, RESOURCE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes).toEqual(['posts:read', 'posts:write']);
  });

  it('treats an unverifiable redirect_uri as FATAL, never redirectable', () => {
    // Bouncing an error to a URI we could not verify is an open redirect, and
    // an open redirect on an OAuth endpoint is a stepping stone.
    const unknown = checkAuthorize(base, null, RESOURCE);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.kind).toBe('fatal');

    const mismatched = checkAuthorize({ ...base, redirect_uri: 'https://evil.example.com/cb' }, client, RESOURCE);
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.kind).toBe('fatal');
  });

  it('reports everything after that back to the client', () => {
    for (const bad of [
      { ...base, response_type: 'token' },
      { ...base, code_challenge_method: 'plain' },
      { ...base, code_challenge: 'short' },
      { ...base, resource: 'https://someone-else.example.com/api/mcp' },
    ]) {
      const r = checkAuthorize(bad, client, RESOURCE);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.kind).toBe('redirectable');
    }
  });

  it('accepts a request that omits the optional resource', () => {
    expect(checkAuthorize({ ...base, resource: null }, client, RESOURCE).ok).toBe(true);
  });
});

describe('authorizeRedirect', () => {
  it('carries code, state and iss on success', () => {
    const u = new URL(authorizeRedirect('https://app.example.com/cb', ISSUER, { code: 'abc' }, 'st'));
    expect(u.searchParams.get('code')).toBe('abc');
    expect(u.searchParams.get('state')).toBe('st');
    // RFC 9207 — without iss a client cannot detect a mix-up attack.
    expect(u.searchParams.get('iss')).toBe(ISSUER);
  });

  it('carries iss on errors too', () => {
    const u = new URL(authorizeRedirect('https://app.example.com/cb', ISSUER, { error: 'access_denied' }, null));
    expect(u.searchParams.get('error')).toBe('access_denied');
    expect(u.searchParams.get('iss')).toBe(ISSUER);
    expect(u.searchParams.get('state')).toBeNull();
  });

  it('keeps a query string the client already had', () => {
    const u = new URL(authorizeRedirect('https://app.example.com/cb?tenant=9', ISSUER, { code: 'abc' }, null));
    expect(u.searchParams.get('tenant')).toBe('9');
    expect(u.searchParams.get('code')).toBe('abc');
  });
});

describe('token shapes', () => {
  it('mints something that reads as an access token and nothing else', () => {
    const { secret, hash } = mintOpaque(ACCESS_PREFIX);
    expect(looksLikeAccessToken(secret)).toBe(true);
    expect(looksLikeAccessToken('gv_mcp_abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(looksLikeAccessToken(null)).toBe(false);
    // The digest is what gets stored; the secret must not be recoverable.
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(secret);
  });

  it('is unique per mint', () => {
    expect(mintOpaque(ACCESS_PREFIX).secret).not.toBe(mintOpaque(ACCESS_PREFIX).secret);
  });
});

describe('normalizeResource', () => {
  it('forgives a trailing slash and case, nothing else', () => {
    expect(normalizeResource('https://trygroveai.com/api/mcp/')).toBe(normalizeResource(RESOURCE));
    expect(normalizeResource('HTTPS://TryGroveAI.com/api/mcp')).toBe(normalizeResource(RESOURCE));
    expect(normalizeResource('https://trygroveai.com/api/mcp2')).not.toBe(normalizeResource(RESOURCE));
  });
});
