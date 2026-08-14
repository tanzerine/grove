/**
 * What a real client sees in its first three messages.
 *
 * The pure pieces are covered elsewhere; this is the seam between them — the
 * handlers actually mounted on the methods a client calls before it can do
 * anything. It's the failure nobody notices in review: a method registered
 * under a typo'd name, a capability advertised for a handler that isn't there,
 * a tool list that drops a tool. The client connects, shows the server as
 * green, and the agent quietly has fewer tools than it should.
 *
 * initialize / tools/list / prompts/* / resources/templates/list touch no
 * database, so the whole handshake runs here with a plain object for the
 * domain row.
 */
import { describe, it, expect } from 'vitest';
import { handleBody } from '@/lib/mcp/protocol';
import { buildHandlers } from '@/lib/mcp/server';

/**
 * Written out rather than derived from the catalog: comparing the catalog to
 * itself would pass just as happily with a tool accidentally deleted. This is
 * also the published surface — customers wire agents to these names, so
 * removing or renaming one should require editing this line on purpose.
 */
const EXPECTED_TOOLS = [
  'describe_blog', 'get_article', 'integration_kit', 'list_articles', 'plan_sync', 'set_article_base',
];

const domain = {
  id: 'd1',
  hostname: 'acme.com',
  blog_slug: 'acme-com-ab12',
  canonical_blog_base: null,
  custom_blog_hostname: null,
};

const handlers = buildHandlers(domain);

async function call(method: string, params: unknown = {}) {
  const reply = await handleBody({ jsonrpc: '2.0', id: 1, method, params }, handlers);
  return reply.body as { result?: any; error?: any };
}

describe('the handshake', () => {
  it('answers initialize with the version the client asked for', async () => {
    const res = await call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '1.0.0' },
    });
    expect(res.error).toBeUndefined();
    expect(res.result.protocolVersion).toBe('2025-03-26');
    expect(res.result.serverInfo.name).toBe('grove');
  });

  it('advertises only capabilities it actually implements', async () => {
    const res = await call('initialize', {});
    const caps = Object.keys(res.result.capabilities).sort();
    expect(caps).toEqual(['prompts', 'resources', 'tools']);
    // Each advertised capability must have its list method mounted, or a
    // client calls it on connect and gets METHOD_NOT_FOUND on a green server.
    for (const method of ['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']) {
      expect(typeof handlers[method], `${method} must be mounted`).toBe('function');
    }
  });

  it('carries the integration contract in instructions, where clients show it', async () => {
    const res = await call('initialize', {});
    expect(res.result.instructions).toContain('set_article_base');
  });

  it('answers ping', async () => {
    expect((await call('ping')).result).toEqual({});
  });

  it('lists every tool in the catalog, each with an object input schema', async () => {
    const res = await call('tools/list');
    const names = res.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(EXPECTED_TOOLS);
    for (const tool of res.result.tools) {
      expect(tool.inputSchema.type, `${tool.name} inputSchema`).toBe('object');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('builds a prompt into a user message', async () => {
    const res = await call('prompts/get', { name: 'sync_grove', arguments: {} });
    expect(res.result.messages[0].role).toBe('user');
    expect(res.result.messages[0].content.text).toContain('plan_sync');
  });

  it('reports an unknown prompt as invalid params, not a crash', async () => {
    const res = await call('prompts/get', { name: 'nope' });
    expect(res.error.code).toBe(-32602);
  });

  it('offers the article resource template', async () => {
    const res = await call('resources/templates/list');
    expect(res.result.resourceTemplates[0].uriTemplate).toBe('grove://article/{slug}');
  });

  it('rejects an unknown tool by name', async () => {
    const res = await call('tools/call', { name: 'delete_everything', arguments: {} });
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toContain('delete_everything');
  });
});
