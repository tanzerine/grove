/**
 * What a tool call sends to PostHog — checked at the wire, because a
 * `$mcp_tool_call` that lands under the wrong person, or carries a whole
 * article in `$mcp_parameters`, looks fine from the inside.
 */
import { gunzipSync } from 'node:zlib';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let bodies: any[] = [];

beforeEach(() => {
  vi.resetModules();
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    // posthog-node gzips the batch; a string body means compression was off.
    const raw = typeof init.body === 'string'
      ? init.body
      : gunzipSync(Buffer.from(await new Response(init.body).arrayBuffer())).toString('utf8');
    bodies.push(JSON.parse(raw));
    return new Response('{"status":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const events = () => bodies.flatMap((b) => b.batch ?? []);

describe('captureMcpToolCall', () => {
  it('sends one $mcp_tool_call for the grove server, under the Supabase user id, without arguments', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'phc_test');
    const { captureMcpToolCall, flushMcpAnalyticsAfterResponse } = await import('@/lib/mcp/analytics');

    captureMcpToolCall({ userId: 'u1', toolName: 'list_sites', durationMs: 12, isError: false, userAgent: 'claude-code/2.0 (cli)' });
    flushMcpAnalyticsAfterResponse();
    await vi.waitFor(() => expect(events().length).toBeGreaterThan(0));

    const calls = events().filter((e) => e.event === '$mcp_tool_call');
    expect(calls).toHaveLength(1);
    const [e] = calls;
    expect(e.distinct_id).toBe('u1');
    expect(e.properties.$mcp_tool_name).toBe('list_sites');
    expect(e.properties.$mcp_server_name).toBe('grove');
    expect(e.properties.$mcp_is_error).toBe(false);
    expect(e.properties.$mcp_client_user_agent).toBe('claude-code/2.0 (cli)');
    expect(e.properties).not.toHaveProperty('$mcp_parameters');
    expect(e.properties).not.toHaveProperty('$mcp_response');
  });

  it('is a no-op without a project token', async () => {
    const { captureMcpToolCall, flushMcpAnalyticsAfterResponse } = await import('@/lib/mcp/analytics');
    captureMcpToolCall({ userId: 'u1', toolName: 'list_sites', durationMs: 1, isError: false });
    flushMcpAnalyticsAfterResponse();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
  });
});
