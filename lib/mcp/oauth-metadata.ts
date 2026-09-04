/**
 * OAuth discovery documents for the MCP endpoint (RFC 9728 + RFC 6750).
 *
 * WHAT THIS IS FOR. Today a customer's install command carries their key, so
 * every command is unique and has to be fetched from the dashboard first. The
 * MCP spec's answer is for the server to say, in its 401, where its
 * authorization server lives — the client then does the whole dance itself and
 * the install string becomes a constant. This module is the first half of that:
 * the challenge that points somewhere, and the document it points at.
 *
 * EVERY URL IS BUILT FROM `base`, WHICH MUST BE `appBase()`. Grove serves whole
 * blogs on hostnames its customers control (`custom_blog_hostname`), so a URL
 * derived from the request's Host header would let blog.acme.com advertise
 * itself as grove's authorization server. Taking the base as an argument and
 * never reading a header is what makes that impossible rather than merely
 * unlikely — the same rule lib/seo.ts already enforces for blog URLs.
 *
 * Pure string building, so the shapes are testable without a request.
 */

/**
 * Scopes, named for the resource rather than the verb.
 *
 * These map onto the existing `Scope` type ('read' | 'write') at the auth
 * boundary, so `hasScope()` and every tool's declared scope stay exactly as
 * they are — the OAuth work must not reach into the tool layer.
 *
 * `offline_access` is deliberately absent: the spec is explicit that refresh is
 * a client concern, not a resource requirement, and servers SHOULD NOT
 * advertise it here.
 */
export const MCP_SCOPES = ['posts:read', 'posts:write'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** The minimum a token needs to reach the endpoint at all. Write is obtained
 *  on top of it, via the step-up flow, when a write tool is actually called. */
export const MINIMUM_SCOPE: McpScope = 'posts:read';

/** The MCP endpoint's path on the app origin. */
const MCP_PATH = '/api/mcp';

const trim = (base: string) => base.replace(/\/+$/, '');

/**
 * The canonical resource identifier (RFC 8707 §2): absolute, no fragment, no
 * trailing slash. This exact string is what a token's audience is checked
 * against later, so it has one definition and this is it.
 */
export function mcpResourceUri(base: string): string {
  return `${trim(base)}${MCP_PATH}`;
}

/**
 * Where the metadata document lives.
 *
 * RFC 9728 builds this by inserting the well-known segment BETWEEN the host and
 * the resource's path — `/.well-known/oauth-protected-resource/api/mcp`, not
 * the bare well-known path. Clients are required to use whatever the challenge
 * names, so this is the value that matters; the bare path is also served,
 * because that is what several clients probe first.
 */
export function protectedResourceMetadataUrl(base: string): string {
  return `${trim(base)}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export type ProtectedResourceMetadata = {
  resource: string;
  resource_name: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_documentation: string;
};

/**
 * The RFC 9728 document.
 *
 * Grove is its own authorization server: it already authenticates these exact
 * people through Supabase, so the consent screen is a page the customer reaches
 * already signed in, and there is no second service to operate.
 */
export function protectedResourceMetadata(base: string): ProtectedResourceMetadata {
  const origin = trim(base);
  return {
    resource: mcpResourceUri(origin),
    resource_name: 'grove',
    authorization_servers: [origin],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/dashboard/mcp`,
  };
}

/** Why the request was refused, in the vocabulary of lib/mcp/auth.ts. */
export type ChallengeReason = 'missing' | 'invalid';

/**
 * The `WWW-Authenticate` value for a 401.
 *
 * Two details the previous hand-rolled header got wrong:
 *
 * 1. No `resource_metadata`, so a spec-current client learned that auth was
 *    required and had nowhere to go — it fell back to asking a human to paste a
 *    token, which is the exact behaviour this work exists to remove.
 * 2. `error="invalid_token"` on a request that carried no credentials at all.
 *    RFC 6750 §3.1 reserves the error codes for credentials that were sent and
 *    rejected; a challenge to an unauthenticated request omits `error`
 *    entirely. Sending one tells the client a token was tried and failed, which
 *    is how a first connection gets reported to the customer as a bad key.
 */
export function challengeHeader(base: string, reason: ChallengeReason, description?: string): string {
  const parts = ['realm="grove"'];
  if (reason === 'invalid') parts.push('error="invalid_token"');
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  parts.push(`resource_metadata="${protectedResourceMetadataUrl(base)}"`);
  // Least privilege on the first hop: the client asks for the minimum that
  // reaches the resource, and steps up when it actually needs to write.
  parts.push(`scope="${MINIMUM_SCOPE}"`);
  return `Bearer ${parts.join(', ')}`;
}
