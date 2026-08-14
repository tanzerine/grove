/**
 * The MCP wire layer.
 *
 * Grove speaks this protocol to software it will never see — Claude Code,
 * Cursor, whatever a customer's team uses — and the failure mode of getting it
 * subtly wrong is not an exception in a log. It's a client that connects, shows
 * the server as green, and then behaves oddly: a duplicate response to a
 * notification, a 200 where a 202 was owed, a handshake answered with a version
 * the client didn't ask for. Nobody debugs that from grove's side, so the
 * envelope rules are pinned here.
 */
import { describe, it, expect } from 'vitest';
import {
  parseBody, handleCall, handleBody, negotiateProtocol, rpcError, rpcResult,
  RpcError, RPC, LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS,
  type Handlers,
} from '@/lib/mcp/protocol';

const req = (method: string, params?: unknown, id: unknown = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const note = (method: string, params?: unknown) => ({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });

const handlers: Handlers = {
  ping: () => ({}),
  echo: (params) => ({ got: params }),
  boom: () => { throw new Error('kaboom'); },
  refuse: () => { throw new RpcError(RPC.INVALID_PARAMS, 'slug is required'); },
};

describe('parseBody', () => {
  it('accepts a single request and a batch alike', () => {
    const one = parseBody(req('ping'));
    expect(one.ok && one.batch).toBe(false);
    expect(one.ok && one.calls).toHaveLength(1);

    const many = parseBody([req('ping', undefined, 1), req('ping', undefined, 2)]);
    expect(many.ok && many.batch).toBe(true);
    expect(many.ok && many.calls).toHaveLength(2);
  });

  it('distinguishes a notification from a request by the PRESENCE of id, not its value', () => {
    // id: null is a legal (if unusual) request id. Treating it as absent would
    // silently swallow the response the client is waiting for.
    const withNull = parseBody(req('ping', undefined, null));
    expect(withNull.ok && 'id' in withNull.calls[0]).toBe(true);

    const withoutId = parseBody(note('notifications/initialized'));
    expect(withoutId.ok && 'id' in withoutId.calls[0]).toBe(false);
  });

  it('defaults params to an object so handlers never have to null-check', () => {
    const p = parseBody(req('ping'));
    expect(p.ok && p.calls[0].params).toEqual({});
  });

  it('rejects a non-object message, a wrong version, and array params', () => {
    expect(parseBody('hello').ok).toBe(false);
    expect(parseBody({ jsonrpc: '1.0', id: 1, method: 'ping' }).ok).toBe(false);
    expect(parseBody({ jsonrpc: '2.0', id: 1, method: 'ping', params: [1, 2] }).ok).toBe(false);
  });

  it('drops responses instead of erroring on them', () => {
    // A reply to a server→client request. We never send any, so there is
    // nothing to do — but the spec still expects a 202, not an error.
    const p = parseBody({ jsonrpc: '2.0', id: 7, result: { ok: true } });
    expect(p.ok && p.calls).toHaveLength(0);
  });

  it('refuses an empty or oversized batch', () => {
    expect(parseBody([]).ok).toBe(false);
    expect(parseBody(Array.from({ length: 65 }, () => req('ping'))).ok).toBe(false);
  });
});

describe('handleCall', () => {
  it('answers a request and stays silent for a notification', async () => {
    await expect(handleCall({ id: 1, method: 'ping', params: {} }, handlers)).resolves.toEqual(rpcResult(1, {}));
    await expect(handleCall({ method: 'ping', params: {} }, handlers)).resolves.toBeNull();
  });

  it('reports an unknown METHOD but ignores an unknown NOTIFICATION', async () => {
    const res = await handleCall({ id: 2, method: 'nope', params: {} }, handlers);
    expect(res).toEqual(rpcError(2, RPC.METHOD_NOT_FOUND, 'unknown method: nope'));

    // Clients send notifications/cancelled and notifications/progress freely.
    // Erroring on every unimplemented one would fill their logs with noise
    // about messages that by definition expect no reply.
    await expect(handleCall({ method: 'notifications/cancelled', params: {} }, handlers)).resolves.toBeNull();
  });

  it('passes an RpcError through and makes anything else opaque', async () => {
    const refused = await handleCall({ id: 3, method: 'refuse', params: {} }, handlers);
    expect(refused).toEqual(rpcError(3, RPC.INVALID_PARAMS, 'slug is required'));

    // An unexpected throw is grove's problem, not the caller's business — no
    // stack trace, no internal message.
    const crashed = await handleCall({ id: 4, method: 'boom', params: {} }, handlers);
    expect(crashed).toEqual(rpcError(4, RPC.INTERNAL_ERROR, 'internal error'));
  });
});

describe('handleBody', () => {
  it('answers a lone request with a bare object, not an array', async () => {
    const reply = await handleBody(req('echo', { a: 1 }), handlers);
    expect(reply.status).toBe(200);
    expect(Array.isArray(reply.body)).toBe(false);
    expect(reply.body).toEqual(rpcResult(1, { got: { a: 1 } }));
  });

  it('answers a batch with an array of only the responses it owes', async () => {
    const reply = await handleBody([req('ping', undefined, 1), note('notifications/initialized'), req('ping', undefined, 2)], handlers);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual([rpcResult(1, {}), rpcResult(2, {})]);
  });

  it('returns 202 and NO body when nothing is owed', async () => {
    // The handshake's second message is a notification. A client that gets a
    // response to it has been handed a reply to a message with no id — some
    // log it as a protocol violation, and none of them want it.
    const reply = await handleBody(note('notifications/initialized'), handlers);
    expect(reply.status).toBe(202);
    expect(reply.body).toBeNull();
  });

  it('returns 400 with a JSON-RPC error for a malformed body', async () => {
    const reply = await handleBody({ jsonrpc: '2.0' }, handlers);
    expect(reply.status).toBe(400);
    expect((reply.body as { error: { code: number } }).error.code).toBe(RPC.INVALID_REQUEST);
  });
});

describe('negotiateProtocol', () => {
  it('echoes any revision we support', () => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) expect(negotiateProtocol(v)).toBe(v);
  });

  it('falls back to the latest for an unknown, missing or garbage version', () => {
    // A missing version must not fail the handshake: some clients omit it, and
    // a server that refuses them is a server they simply cannot connect to.
    expect(negotiateProtocol(undefined)).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocol('2099-01-01')).toBe(LATEST_PROTOCOL_VERSION);
    expect(negotiateProtocol(42)).toBe(LATEST_PROTOCOL_VERSION);
  });
});
