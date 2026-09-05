/**
 * The discovery documents a client reads before it has any credentials.
 *
 * Everything here is a string a machine parses and a human never sees, which is
 * the whole reason it needs tests: a wrong path or a missing parameter doesn't
 * throw, it just makes the client give up and ask a person to paste a key —
 * which is indistinguishable from grove not supporting OAuth at all.
 */
import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_SCOPES,
  MCP_SCOPES,
  challengeHeader,
  insufficientScopeHeader,
  mcpResourceUri,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from '@/lib/mcp/oauth-metadata';

const BASE = 'https://trygroveai.com';

describe('resource identity', () => {
  it('is the MCP endpoint itself, absolute and without a trailing slash', () => {
    // RFC 8707 §2 — this exact string is what a token's audience gets checked
    // against, so it cannot drift between the document and the validator.
    expect(mcpResourceUri(BASE)).toBe('https://trygroveai.com/api/mcp');
  });

  it('survives a base that arrives with a trailing slash', () => {
    expect(mcpResourceUri('https://trygroveai.com/')).toBe('https://trygroveai.com/api/mcp');
    expect(protectedResourceMetadataUrl('https://trygroveai.com/')).not.toContain('//.well-known');
  });

  it('inserts the well-known segment before the resource path, per RFC 9728', () => {
    expect(protectedResourceMetadataUrl(BASE))
      .toBe('https://trygroveai.com/.well-known/oauth-protected-resource/api/mcp');
  });
});

describe('protected resource metadata', () => {
  const doc = protectedResourceMetadata(BASE);

  it('names grove as its own authorization server', () => {
    expect(doc.resource).toBe('https://trygroveai.com/api/mcp');
    expect(doc.authorization_servers).toEqual(['https://trygroveai.com']);
    expect(doc.bearer_methods_supported).toEqual(['header']);
  });

  it('does not advertise offline_access', () => {
    // The spec is explicit: refresh is a client concern, not a requirement of
    // the resource, and a protected resource SHOULD NOT list it here.
    expect(doc.scopes_supported).not.toContain('offline_access');
    expect(doc.scopes_supported).toEqual([...MCP_SCOPES]);
  });

  it('builds every URL from the base it was given and nothing else', () => {
    // Grove serves customer-controlled hostnames. If any URL here were derived
    // from a request Host instead of appBase(), blog.acme.com could advertise
    // itself as grove's authorization server.
    const rogue = protectedResourceMetadata('https://blog.acme.com');
    const urls = [rogue.resource, ...rogue.authorization_servers, rogue.resource_documentation];
    expect(urls.every((u) => u.startsWith('https://blog.acme.com'))).toBe(true);
    expect(JSON.stringify(rogue)).not.toContain('trygroveai.com');
  });
});

describe('challengeHeader', () => {
  it('points an unauthenticated client at the metadata document', () => {
    const h = challengeHeader(BASE, 'missing');
    expect(h).toContain('resource_metadata="https://trygroveai.com/.well-known/oauth-protected-resource/api/mcp"');
    expect(h.startsWith('Bearer ')).toBe(true);
  });

  it('asks for the scopes grove’s documented loop actually needs', () => {
    // Phase 0 challenged for posts:read alone, on a least-privilege reading.
    // With the flow built that is wrong for this resource: the loop is
    // pull_new → write the article → record_delivery, so a read-only grant
    // fails on the customer's SECOND call, every time, and the step-up that
    // would rescue it does not exist yet. Asking once beats asking twice.
    expect(challengeHeader(BASE, 'missing')).toContain('scope="posts:read posts:write"');
    expect(CHALLENGE_SCOPES).toEqual(['posts:read', 'posts:write']);
  });

  it('omits error when no credentials were sent at all', () => {
    // RFC 6750 §3.1 reserves the error codes for credentials that WERE sent and
    // rejected. Sending invalid_token on a first, credential-less connection
    // tells the client a key was tried and failed — which is how a brand new
    // install gets reported to the customer as a bad key.
    expect(challengeHeader(BASE, 'missing')).not.toContain('error="invalid_token"');
    expect(challengeHeader(BASE, 'invalid')).toContain('error="invalid_token"');
  });

  it('never lets a description break out of its quotes', () => {
    const h = challengeHeader(BASE, 'invalid', 'a "quoted" reason');
    expect(h).toContain(`error_description="a 'quoted' reason"`);
    // One opening quote per parameter and no stray ones in between.
    expect((h.match(/"/g) ?? []).length % 2).toBe(0);
  });

  it('keeps the parameters comma-separated in one Bearer challenge', () => {
    const h = challengeHeader(BASE, 'invalid', 'nope');
    expect(h.split('Bearer ').length).toBe(2);
    expect(h).toMatch(/^Bearer realm="grove", error="invalid_token", error_description=".*", resource_metadata=".*", scope=".*"$/);
  });
});

describe('insufficientScopeHeader', () => {
  it('is a 403 challenge, not a 401 one', () => {
    const h = insufficientScopeHeader(BASE, ['posts:read', 'posts:write'], 'record_delivery needs write access.');
    // The distinction a client branches on: invalid_token means "authenticate
    // again", insufficient_scope means "you are known, ask for more". A client
    // told the first for a scope problem throws away a working token.
    expect(h).toContain('error="insufficient_scope"');
    expect(h).not.toContain('invalid_token');
  });

  it('names every scope the operation needs, not just the missing one', () => {
    // Re-authorizing with only the missing half would drop the half already
    // granted, so the client would step up and immediately lose read access.
    const h = insufficientScopeHeader(BASE, ['posts:read', 'posts:write'], 'x');
    expect(h).toContain('scope="posts:read posts:write"');
    expect(h).toContain('resource_metadata="https://trygroveai.com/.well-known/oauth-protected-resource/api/mcp"');
  });
});
