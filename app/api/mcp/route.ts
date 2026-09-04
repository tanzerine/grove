/**
 * POST /api/mcp — grove's MCP server (Streamable HTTP transport).
 *
 * This is the thick-blog path. A customer who already runs a content layer —
 * MDX in a repo, a CMS, a bespoke pipeline — points their coding agent here and
 * the finished articles land inside the blog they already have, in that layer's
 * own shape. No script tag, no iframe, no second blog beside the first.
 *
 * Shape of the transport: one POST carrying JSON-RPC in, one JSON response out.
 * Stateless — no session id is issued, so any instance can serve any call and a
 * cold serverless start costs nothing. The spec permits both (a server MAY
 * answer `application/json` instead of opening an SSE stream, and a server with
 * no session state never issues `Mcp-Session-Id`), and nothing grove does here
 * is long-running or server-initiated, so a stream would only be a socket held
 * open for no traffic.
 *
 * Auth is a bearer key (lib/mcp/keys). The MCP spec prefers OAuth for remote
 * servers, but the client here is an agent on a developer's laptop or in CI,
 * where a revocable, scopeable key in a header is what every client can
 * actually send today.
 */
import { NextResponse } from 'next/server';
import { authenticate, touchKey, type McpContext } from '@/lib/mcp/auth';
import { callTool } from '@/lib/mcp/handlers';
import { bearerToken } from '@/lib/mcp/keys';
import { challengeHeader } from '@/lib/mcp/oauth-metadata';
import {
  initializeResult, isNotification, LATEST_PROTOCOL, parseBody, RPC, rpcError, rpcResult,
  type RpcRequest, type RpcResponse,
} from '@/lib/mcp/protocol';
import { toolListPayload } from '@/lib/mcp/tools';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { appBase } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A first import can ask for twenty full articles at once; the default 15s
// would cut that off half way through serialising them.
export const maxDuration = 60;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  // `mcp-protocol-version` is sent by spec-current clients on every request
  // after initialize; omitting it here fails the browser preflight and the
  // connection dies before the first tool call.
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-api-key',
  // www-authenticate carries the whole discovery pointer. A browser-based
  // client cannot read a response header it was not explicitly given, so
  // without this the 401 arrives with the challenge stripped and the client
  // sees an unexplained failure instead of "here is where to authenticate".
  'access-control-expose-headers': 'mcp-protocol-version, www-authenticate',
  'access-control-max-age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * Clients probe GET to open the server→client SSE stream. Grove never pushes,
 * so 405 is the spec's own answer for a server that doesn't offer one — and it
 * has to be a clean 405, because a client that gets a 200 here waits forever
 * for events that will not come.
 */
export async function GET() {
  return NextResponse.json(
    {
      error: 'This MCP endpoint is POST-only (no server-initiated stream). Send JSON-RPC over POST with an Authorization: Bearer <key> header.',
      docs: `${appBase()}/dashboard/mcp`,
    },
    { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } },
  );
}

export async function POST(req: Request) {
  const secret = bearerToken({
    authorization: req.headers.get('authorization'),
    apiKey: req.headers.get('x-api-key'),
  });

  const auth = await authenticate(secret);

  if (!auth.ok && auth.reason === 'unavailable') {
    // Grove's problem, not the key's. 503 + a retryable JSON-RPC error, so the
    // agent waits instead of telling the customer their credential is broken.
    return NextResponse.json(
      rpcError(null, RPC.INTERNAL_ERROR, 'Grove could not verify the key right now. Retry shortly.'),
      { status: 503, headers: { ...CORS, 'retry-after': '30' } },
    );
  }

  if (!auth.ok) {
    // WWW-Authenticate is what tells a spec-current client this is an auth
    // problem it can prompt about, rather than a broken server — and, now that
    // it carries resource_metadata, where to go and solve it without a human
    // pasting a key. See lib/mcp/oauth-metadata.ts.
    const message =
      auth.reason === 'missing'
        ? 'Missing credentials. Send Authorization: Bearer <grove MCP key>.'
        : auth.reason === 'malformed'
          ? 'That does not look like a grove MCP key (they start with gv_mcp_).'
          : 'This key is not valid. It may have been revoked, expired, or belong to another environment.';

    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: RPC.INVALID_REQUEST, message } },
      {
        status: 401,
        headers: {
          ...CORS,
          'www-authenticate': challengeHeader(
            appBase(),
            auth.reason === 'missing' ? 'missing' : 'invalid',
            message,
          ),
        },
      },
    );
  }

  const ctx = auth.ctx;

  const limited = await enforceRateLimit(`mcp:${ctx.userId}`, LIMITS.mcp);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, RPC.PARSE_ERROR, 'Invalid JSON'), { status: 400, headers: CORS });
  }

  const parsed = parseBody(body);
  if (parsed.kind === 'invalid') {
    return NextResponse.json(rpcError(null, RPC.INVALID_REQUEST, parsed.message), { status: 400, headers: CORS });
  }

  const responses: RpcResponse[] = [];
  let calledTool: string | null = null;
  for (const msg of parsed.messages) {
    if (msg.method === 'tools/call') calledTool = String((msg.params as any)?.name ?? '') || calledTool;
    const res = await handle(msg, ctx);
    // A notification gets no reply, ever — answering one makes every client log
    // an unsolicited response to `notifications/initialized` on connect.
    if (res && !isNotification(msg)) responses.push(res);
  }

  // Usage trail after the work, not before: a rate-limited or malformed call
  // shouldn't move "last used".
  await touchKey(ctx.keyId, calledTool);

  if (!responses.length) {
    // Everything in the payload was a notification. 202 with no body is what
    // the spec asks for.
    return new NextResponse(null, { status: 202, headers: CORS });
  }

  const payload = parsed.kind === 'batch' ? responses : responses[0];
  return NextResponse.json(payload, {
    headers: { ...CORS, 'mcp-protocol-version': LATEST_PROTOCOL, 'cache-control': 'no-store' },
  });
}

async function handle(msg: RpcRequest, ctx: McpContext): Promise<RpcResponse | null> {
  const id = msg.id ?? null;

  switch (msg.method) {
    case 'initialize':
      return rpcResult(id, initializeResult(msg.params));

    // Lifecycle chatter. Acknowledged by doing nothing, which is exactly right:
    // they are notifications and carry no id.
    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/progress':
      return null;

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: toolListPayload() });

    case 'tools/call': {
      const name = String((msg.params as any)?.name ?? '');
      if (!name) return rpcError(id, RPC.INVALID_PARAMS, 'tools/call needs a "name"');
      try {
        const result = await callTool(name, (msg.params as any)?.arguments, ctx);
        return rpcResult(id, result);
      } catch (e: any) {
        // An exception inside a tool is still a tool failure, not a transport
        // failure: report it as a result so the model can read it and adjust.
        return rpcResult(id, {
          content: [{ type: 'text', text: `"${name}" failed: ${e?.message ?? String(e)}` }],
          isError: true,
        });
      }
    }

    // Resources: the integration guide, so a client that browses resources
    // rather than calling tools still finds the one document that stops the
    // integration being wired up wrong.
    case 'resources/list':
      return rpcResult(id, {
        resources: [
          {
            uri: 'grove://guide/content-layer',
            name: 'content-layer-guide',
            title: 'Grove → your content layer',
            description: 'How to import grove articles into an existing blog: the sync loop, the analytics beacon, canonical URLs, and what each frontmatter field means.',
            mimeType: 'text/markdown',
          },
        ],
      });

    case 'resources/read': {
      const uri = String((msg.params as any)?.uri ?? '');
      if (uri !== 'grove://guide/content-layer') {
        return rpcError(id, RPC.INVALID_PARAMS, `Unknown resource "${uri}"`);
      }
      const result = await callTool('integration_guide', {}, ctx);
      const text = result.content.map((c) => c.text).join('\n');
      return rpcResult(id, { contents: [{ uri, mimeType: 'text/markdown', text }] });
    }

    // Declared in no capability, so a spec-following client never asks. The
    // ones that ask anyway get an empty list rather than an error in their log.
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });

    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Unsupported method "${msg.method}"`);
  }
}
