/**
 * The MCP wire format.
 *
 * Grove hand-rolls the transport rather than pulling in the SDK, so the parts
 * of JSON-RPC that clients depend on silently — never answering a notification,
 * never echoing a protocol version we don't speak, reporting tool failures as
 * results rather than errors — have to be pinned here. Each of these is a bug
 * that shows up as "the MCP server doesn't work in <client>" and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import {
  INSTRUCTIONS, LATEST_PROTOCOL, PROTOCOL_VERSIONS, RPC, initializeResult, isNotification,
  negotiateProtocol, parseBody, rpcError, rpcResult, toolError, toolJson, toolText,
} from '@/lib/mcp/protocol';
import { TOOL_NAMES } from '@/lib/mcp/tools';

describe('parseBody', () => {
  it('accepts a single request', () => {
    const p = parseBody({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(p.kind).toBe('single');
    if (p.kind !== 'invalid') expect(p.messages[0].method).toBe('tools/list');
  });

  it('accepts a batch and keeps the order', () => {
    const p = parseBody([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]);
    expect(p.kind).toBe('batch');
    if (p.kind !== 'invalid') expect(p.messages.map((m) => m.method)).toEqual(['ping', 'notifications/initialized']);
  });

  it('rejects anything that is not JSON-RPC 2.0', () => {
    expect(parseBody({ id: 1, method: 'tools/list' }).kind).toBe('invalid');
    expect(parseBody({ jsonrpc: '1.0', method: 'x' }).kind).toBe('invalid');
    expect(parseBody({ jsonrpc: '2.0' }).kind).toBe('invalid');
    expect(parseBody(null).kind).toBe('invalid');
    expect(parseBody('tools/list').kind).toBe('invalid');
    expect(parseBody([]).kind).toBe('invalid');
  });

  it('rejects an id that is neither string nor number', () => {
    // A client that sends {"id":{}} gets a clean error rather than a response
    // it can never correlate.
    expect(parseBody({ jsonrpc: '2.0', id: {}, method: 'ping' }).kind).toBe('invalid');
  });

  it('drops array params rather than passing them off as an object', () => {
    const p = parseBody({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: ['a'] });
    expect(p.kind).toBe('single');
    if (p.kind !== 'invalid') expect(p.messages[0].params).toBeUndefined();
  });
});

describe('isNotification', () => {
  it('treats a missing or null id as a notification', () => {
    // Answering `notifications/initialized` makes every client log an
    // unsolicited response on connect — this is the guard against that.
    expect(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true);
    expect(isNotification({ jsonrpc: '2.0', id: null, method: 'x' })).toBe(true);
  });

  it('treats id 0 as a real request', () => {
    // The falsy trap: `if (!msg.id)` would swallow the response to id 0 and the
    // client would hang on its very first call.
    expect(isNotification({ jsonrpc: '2.0', id: 0, method: 'ping' })).toBe(false);
    expect(isNotification({ jsonrpc: '2.0', id: '', method: 'ping' })).toBe(false);
  });
});

describe('negotiateProtocol', () => {
  it('echoes a version grove actually speaks', () => {
    for (const v of PROTOCOL_VERSIONS) expect(negotiateProtocol(v)).toBe(v);
  });

  it('answers with its own latest for anything else, never echoing an unknown version', () => {
    // Echoing back "2099-01-01" would claim support grove does not have.
    expect(negotiateProtocol('2099-01-01')).toBe(LATEST_PROTOCOL);
    expect(negotiateProtocol(undefined)).toBe(LATEST_PROTOCOL);
    expect(negotiateProtocol(42)).toBe(LATEST_PROTOCOL);
  });
});

describe('initializeResult', () => {
  it('declares only the capabilities grove implements', () => {
    const r = initializeResult({ protocolVersion: LATEST_PROTOCOL }) as any;
    expect(r.protocolVersion).toBe(LATEST_PROTOCOL);
    expect(r.capabilities.tools).toBeTruthy();
    expect(r.capabilities.resources).toBeTruthy();
    // No prompts capability, and no listChanged subscription for a static
    // tool set — a client must not wait for notifications grove never sends.
    expect(r.capabilities.prompts).toBeUndefined();
    expect(r.capabilities.tools.listChanged).toBe(false);
    expect(r.serverInfo.name).toBe('grove');
  });

  it('ships instructions that name the tools they tell the agent to use', () => {
    // The instructions go into the client's system prompt. If they reference a
    // tool that has been renamed, the agent is told to call something that
    // isn't there — so the names are checked against the catalogue.
    for (const name of ['list_sites', 'pull_new', 'record_delivery', 'set_canonical_base']) {
      expect(TOOL_NAMES).toContain(name);
      expect(INSTRUCTIONS).toContain(name);
    }
  });
});

describe('results', () => {
  it('builds well-formed responses', () => {
    expect(rpcResult(1, { ok: true })).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    expect(rpcError(1, RPC.METHOD_NOT_FOUND, 'nope')).toEqual({
      jsonrpc: '2.0', id: 1, error: { code: RPC.METHOD_NOT_FOUND, message: 'nope' },
    });
    // An absent id is normalised to null, which is what JSON-RPC requires for
    // an error that could not be correlated.
    expect((rpcError(undefined as any, RPC.PARSE_ERROR, 'bad') as any).id).toBeNull();
  });

  it('sends JSON twice — structured for new clients, text for the rest', () => {
    const r = toolJson({ a: 1 });
    expect(r.structuredContent).toEqual({ a: 1 });
    // A client without structuredContent support would otherwise see an empty
    // tool result and report that grove returned nothing.
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
    expect(r.isError).toBeUndefined();
  });

  it('reports a tool failure as a result, not a transport error', () => {
    // isError:true keeps the message in front of the model, which can then fix
    // its arguments. A JSON-RPC error surfaces in the client as a broken
    // server and the model never sees why.
    const e = toolError('No article at slug "nope".');
    expect(e.isError).toBe(true);
    expect(e.content[0].text).toContain('nope');
    expect(toolText('hi').isError).toBeUndefined();
  });
});
