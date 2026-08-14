/**
 * POST /api/mcp — grove's MCP server.
 *
 * The endpoint a customer's coding agent connects to when their site already
 * has a blog. embed.js renders grove's markup on their page; this renders
 * nothing. It hands the agent the articles, the frontmatter, the beacon and
 * the canonical contract, and the agent writes them into whatever content
 * layer the repo already has.
 *
 * This file is deliberately thin: authenticate, rate-limit, hand the JSON to
 * lib/mcp/protocol, serialize the answer. The protocol lives in lib/mcp so it
 * can be tested without a request, and the handlers live in lib/mcp/server so
 * they can be tested without a transport.
 *
 * TRANSPORT. Streamable HTTP, stateless. POST carries every JSON-RPC message;
 * GET (the optional server→client SSE stream) and DELETE (session teardown)
 * are answered 405, which the spec allows for a server that offers neither.
 * No session id is issued, so a client's calls may land on different
 * serverless instances with nothing to reconcile.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hashKey, isKeyShaped, tokenFromHeaders } from '@/lib/mcp/keys';
import { handleBody, rpcError, RPC } from '@/lib/mcp/protocol';
import { buildHandlers, type McpDomain } from '@/lib/mcp/server';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { captureServer } from '@/lib/analytics/capture-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, DELETE, OPTIONS',
  // mcp-protocol-version and mcp-session-id are sent by browser-based clients;
  // omitting them from the allowlist fails the preflight, not the call, which
  // is a confusing way to discover a header you never meant to reject.
  'access-control-allow-headers': 'authorization, content-type, x-api-key, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
};

/** How stale `last_used_at` may get before we spend a write refreshing it.
 *  The column answers "is this key still in use", which does not need
 *  minute-level precision — and a full sync would otherwise cost one extra
 *  write per article. */
const LAST_USED_STALE_MS = 5 * 60 * 1000;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * No SSE stream and no sessions, so both of the other Streamable HTTP verbs
 * are 405. The body is a JSON-RPC error rather than empty so a client that
 * logs the response shows its user something that explains itself.
 */
export async function GET() {
  return NextResponse.json(
    rpcError(null, RPC.INVALID_REQUEST, 'this MCP server is stateless — POST JSON-RPC messages instead; it offers no SSE stream'),
    { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } },
  );
}

export async function DELETE() {
  return NextResponse.json(
    rpcError(null, RPC.INVALID_REQUEST, 'this MCP server is stateless — there is no session to terminate'),
    { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } },
  );
}

export async function POST(req: Request) {
  const auth = await authenticate(req);
  if ('error' in auth) return auth.error;
  const { domain, key } = auth;

  const limited = await enforceRateLimit(`mcp:${key.user_id}`, LIMITS.mcp);
  if (limited) {
    // Preserve the 429 (clients back off on it) but carry CORS through.
    for (const [k, v] of Object.entries(CORS)) limited.headers.set(k, v);
    return limited;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      rpcError(null, RPC.PARSE_ERROR, 'body must be JSON'),
      { status: 400, headers: CORS },
    );
  }

  const reply = await handleBody(body, buildHandlers(domain));

  // One event per client session, on the handshake — see EventMap.mcp_connected.
  const client = clientInfoOf(body);
  if (client) {
    await captureServer(key.user_id, 'mcp_connected', {
      client: client.name,
      client_version: client.version,
    });
  }

  touchKey(key.id, key.last_used_at);

  if (reply.body === null) return new NextResponse(null, { status: reply.status, headers: CORS });
  return NextResponse.json(reply.body, { status: reply.status, headers: CORS });
}

type AuthedKey = { id: string; user_id: string; domain_id: string; last_used_at: string | null };

/**
 * Resolve the bearer token to one key and its domain.
 *
 * Failures are HTTP 401 with a WWW-Authenticate header, not JSON-RPC errors:
 * MCP clients treat a 401 as "this server needs credentials" and say so in
 * their UI, while a 200 carrying an error object reads to them as a working
 * server whose tools all fail.
 */
async function authenticate(
  req: Request,
): Promise<{ domain: McpDomain; key: AuthedKey } | { error: NextResponse }> {
  const token = tokenFromHeaders(req.headers);
  if (!token || !isKeyShaped(token)) return { error: unauthorized('missing or malformed API key') };

  const sb = supabaseAdmin();
  const { data: key } = await sb
    .from('mcp_keys')
    .select('id,user_id,domain_id,last_used_at')
    .eq('token_hash', hashKey(token))
    .is('revoked_at', null)
    .maybeSingle();

  if (!key) return { error: unauthorized('unknown or revoked API key') };

  // select('*'): the handlers read site_profile, branding, cta_url and the two
  // canonical columns, and naming a column that a not-yet-applied migration
  // hasn't added would fail the whole request.
  const { data: domain } = await sb.from('domains').select('*').eq('id', (key as AuthedKey).domain_id).maybeSingle();
  if (!domain) return { error: unauthorized('this key\'s site no longer exists') };

  return { domain: domain as McpDomain, key: key as AuthedKey };
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: 'unauthorized', message: `${message} — create one on the grove dashboard under Embed → your own content layer, and send it as "Authorization: Bearer <key>".` },
    { status: 401, headers: { ...CORS, 'www-authenticate': 'Bearer realm="grove"' } },
  );
}

/** clientInfo from an `initialize` message, if this body is one. */
function clientInfoOf(body: unknown): { name?: string; version?: string } | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    const msg = m as { method?: unknown; params?: { clientInfo?: { name?: unknown; version?: unknown } } };
    if (msg?.method !== 'initialize') continue;
    const info = msg.params?.clientInfo;
    return {
      name: typeof info?.name === 'string' ? info.name.slice(0, 80) : undefined,
      version: typeof info?.version === 'string' ? info.version.slice(0, 40) : undefined,
    };
  }
  return null;
}

/** Refresh last_used_at, at most once every LAST_USED_STALE_MS. Never awaited:
 *  a bookkeeping write must not add latency to a tool call, and a failed one
 *  must not fail it. */
function touchKey(id: string, lastUsed: string | null): void {
  const age = lastUsed ? Date.now() - Date.parse(lastUsed) : Infinity;
  if (Number.isFinite(age) && age < LAST_USED_STALE_MS) return;
  void supabaseAdmin()
    .from('mcp_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
    .then(undefined, () => {});
}
