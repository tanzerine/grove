/**
 * MCP over Streamable HTTP — the wire layer, with no grove in it.
 *
 * This file knows JSON-RPC 2.0 and the MCP envelope; it does not know what a
 * post is. `lib/mcp/server.ts` supplies the method handlers, `app/api/mcp`
 * supplies auth and HTTP. Keeping the envelope pure is what makes protocol
 * behaviour — the 202 for a notification-only body, version negotiation, the
 * error codes a client branches on — testable without a database or a request.
 *
 * WHY HAND-ROLLED rather than @modelcontextprotocol/sdk. The SDK's transports
 * are built around a long-lived Node server object that owns a socket; a Vercel
 * route handler is a function that gets a Request and returns a Response, with
 * no process to keep state in. Grove's server is stateless by construction —
 * every call authenticates from its own bearer token and resolves its own
 * domain row — so the parts of the SDK that would earn their keep (sessions,
 * SSE resumption, server→client requests) are exactly the parts we don't use.
 * What's left is the JSON-RPC envelope below, and a dependency we'd have to
 * keep in step with Next's bundler for it.
 *
 * STATELESS, and therefore:
 *   - no Mcp-Session-Id is issued or required,
 *   - GET (the server→client SSE stream) is answered 405, which the spec
 *     explicitly allows for servers that offer no stream,
 *   - every POST is self-contained; a client may `initialize` on one request
 *     and call a tool on the next without anything being remembered.
 */

/** The revision we implement and advertise. */
export const LATEST_PROTOCOL_VERSION = '2025-06-18';

/**
 * Revisions we will speak if a client asks for them, newest first. The
 * differences that matter to a server this shape are small (2025-03-26 allowed
 * JSON-RPC batching, which 2025-06-18 removed — parseBody accepts arrays
 * either way), so refusing an older client would cost compatibility and buy
 * nothing.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

/** JSON-RPC 2.0 reserved codes. Clients branch on these, so they are exact. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type RpcId = string | number | null;

export type RpcCall = {
  /** Absent on a notification — the one thing that decides whether a reply is
   *  owed. `null` is a legal (if odd) request id and is NOT absence. */
  id?: RpcId;
  method: string;
  params: Record<string, unknown>;
};

export type RpcResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: unknown }
  | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string; data?: unknown } };

/**
 * A handler failure the client should see verbatim — bad params, unknown
 * resource. Anything else thrown becomes an opaque INTERNAL_ERROR, because an
 * unexpected stack trace is grove's problem and not the caller's business.
 */
export class RpcError extends Error {
  code: number;
  data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

export function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

/**
 * Which protocol version to answer `initialize` with.
 *
 * The spec's rule: reply with the client's version when we support it,
 * otherwise with our latest and let the client decide whether to continue. A
 * missing/garbage version is treated as "no preference" rather than an error —
 * some clients omit it, and failing the handshake over a missing string would
 * make the server unusable to them.
 */
export function negotiateProtocol(requested: unknown): string {
  const want = typeof requested === 'string' ? requested.trim() : '';
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(want)
    ? want
    : LATEST_PROTOCOL_VERSION;
}

export type ParsedBody =
  | { ok: true; calls: RpcCall[]; batch: boolean }
  | { ok: false; response: RpcResponse };

/**
 * Validate a decoded POST body into calls we can dispatch.
 *
 * Entries that are RESPONSES (a `result`/`error` with no `method`) are dropped
 * rather than rejected: they're replies to server→client requests, we never
 * send any, and the spec still expects a 202 rather than an error.
 */
export function parseBody(body: unknown): ParsedBody {
  const batch = Array.isArray(body);
  const entries = batch ? (body as unknown[]) : [body];

  if (batch && entries.length === 0) {
    return { ok: false, response: rpcError(null, RPC.INVALID_REQUEST, 'empty batch') };
  }
  if (entries.length > 64) {
    return { ok: false, response: rpcError(null, RPC.INVALID_REQUEST, 'batch too large (max 64)') };
  }

  const calls: RpcCall[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, response: rpcError(null, RPC.INVALID_REQUEST, 'each message must be a JSON-RPC object') };
    }
    const msg = raw as Record<string, unknown>;
    if (msg.jsonrpc !== '2.0') {
      return { ok: false, response: rpcError(idOf(msg), RPC.INVALID_REQUEST, 'jsonrpc must be "2.0"') };
    }
    if (typeof msg.method !== 'string') {
      // A response, not a request. Nothing to do and nothing to complain about.
      if ('result' in msg || 'error' in msg) continue;
      return { ok: false, response: rpcError(idOf(msg), RPC.INVALID_REQUEST, 'method must be a string') };
    }
    const params = msg.params;
    if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
      return { ok: false, response: rpcError(idOf(msg), RPC.INVALID_PARAMS, 'params must be an object') };
    }
    const call: RpcCall = {
      method: msg.method,
      params: (params as Record<string, unknown>) ?? {},
    };
    if ('id' in msg) call.id = msg.id as RpcId;
    calls.push(call);
  }

  return { ok: true, calls, batch };
}

function idOf(msg: Record<string, unknown>): RpcId {
  const id = msg.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}

export type Handlers = Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;

/**
 * Run one call. Returns null for a notification (nothing is owed, and sending
 * a response to one is a protocol violation that some clients log as an error).
 */
export async function handleCall(call: RpcCall, handlers: Handlers): Promise<RpcResponse | null> {
  const isNotification = !('id' in call);
  const handler = handlers[call.method];

  if (!handler) {
    // Unknown notifications are ignored on purpose. Clients send
    // notifications/cancelled and notifications/progress freely, and a server
    // that errored on every one it didn't implement would fill their logs.
    if (isNotification) return null;
    return rpcError(call.id ?? null, RPC.METHOD_NOT_FOUND, `unknown method: ${call.method}`);
  }

  try {
    const result = await handler(call.params);
    return isNotification ? null : rpcResult(call.id ?? null, result);
  } catch (err) {
    if (isNotification) return null;
    if (err instanceof RpcError) {
      return rpcError(call.id ?? null, err.code, err.message, err.data);
    }
    return rpcError(call.id ?? null, RPC.INTERNAL_ERROR, 'internal error');
  }
}

export type HttpReply = { status: number; body: RpcResponse | RpcResponse[] | null };

/**
 * The whole POST, start to finish. The route does auth and JSON decoding; this
 * decides status and body.
 *
 * 202 with no body when the client sent only notifications or responses — the
 * spec is explicit about it, and returning `{}` instead makes strict clients
 * complain about a response to a message that had no id.
 */
export async function handleBody(body: unknown, handlers: Handlers): Promise<HttpReply> {
  const parsed = parseBody(body);
  if (!parsed.ok) return { status: 400, body: parsed.response };

  const responses: RpcResponse[] = [];
  for (const call of parsed.calls) {
    const res = await handleCall(call, handlers);
    if (res) responses.push(res);
  }

  if (responses.length === 0) return { status: 202, body: null };
  return { status: 200, body: parsed.batch ? responses : responses[0] };
}
