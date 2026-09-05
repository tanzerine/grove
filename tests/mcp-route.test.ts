/**
 * The /api/mcp endpoint end to end — a real handshake, over the real route.
 *
 * The unit suites cover framing and tools separately; what only shows up here
 * is the wiring: that a key in a header reaches a scoped query, that a
 * notification gets no reply, that a batch comes back as an array, and that an
 * exception inside a tool arrives as a tool error rather than a 500. Every one
 * of those is invisible until a customer's client refuses to connect.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashKey, mintKey } from '@/lib/mcp/keys';

const KEY = mintKey();
const READ_KEY = mintKey();
/** A browser-granted, read-only OAuth token — the credential that CAN step up. */
const READ_GRANT = 'gvo_' + 'r'.repeat(40);

type Row = Record<string, any>;

const KEYS: Row[] = [
  { id: 'k1', user_id: 'u1', domain_id: null, name: 'Repo agent', scopes: ['read', 'write'], key_hash: KEY.hash, revoked_at: null, expires_at: null, calls: 0 },
  { id: 'k2', user_id: 'u1', domain_id: null, name: 'Read only', scopes: ['read'], key_hash: READ_KEY.hash, revoked_at: null, expires_at: null, calls: 0 },
];

const DOMAINS: Row[] = [
  { id: 'd1', user_id: 'u1', hostname: 'acme.com', blog_slug: 'acme-1', canonical_blog_base: null, custom_blog_hostname: null, site_profile: { business: { name: 'Acme' } }, created_at: '2026-01-01' },
];

const POSTS: Row[] = [
  { id: 'p1', domain_id: 'd1', status: 'published', slug: 'first', title: 'First post', body_md: '# First post\n\nBody one.', meta_description: 'One.', published_at: '2026-01-10T00:00:00Z', updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-01-09' },
];

let deliveries: Row[] = [];

const OAUTH_TOKENS: Row[] = [
  {
    id: 'o1', user_id: 'u1', client_id: 'gvc_a', scopes: ['posts:read'], domain_ids: null,
    resource: 'https://trygroveai.com/api/mcp', token_hash: hashKey(READ_GRANT),
    revoked_at: null, expires_at: '2099-01-01T00:00:00Z', calls: 0,
  },
];

const TABLES: Record<string, () => Row[]> = {
  mcp_keys: () => KEYS,
  oauth_tokens: () => OAUTH_TOKENS,
  domains: () => DOMAINS,
  posts: () => POSTS,
  mcp_deliveries: () => deliveries,
  post_events: () => [],
  rate_hits: () => [],
};

function matches(row: Row, ops: any[][]): boolean {
  for (const [name, ...args] of ops) {
    switch (name) {
      case 'eq': if (row[args[0]] !== args[1]) return false; break;
      case 'neq': if (row[args[0]] === args[1]) return false; break;
      case 'is': if ((row[args[0]] ?? null) !== args[1]) return false; break;
      case 'not': if (args[1] === 'is' && (row[args[0]] ?? null) === args[2]) return false; break;
      case 'in': if (!args[1].includes(row[args[0]])) return false; break;
      case 'gte': if (!(String(row[args[0]] ?? '') >= String(args[1]))) return false; break;
      default: break;
    }
  }
  return true;
}

function runQuery(table: string, ops: any[][]): any {
  const write = ops.find(([n]) => n === 'upsert' || n === 'update' || n === 'insert');
  if (write) {
    const [kind, payload] = write;
    if (table === 'mcp_deliveries' && (kind === 'upsert' || kind === 'insert')) {
      deliveries = deliveries.filter((d) => d.post_id !== payload.post_id).concat([{ ...payload }]);
    }
    if (kind === 'update') for (const r of (TABLES[table]?.() ?? []).filter((x) => matches(x, ops))) Object.assign(r, payload);
    return { data: payload, error: null };
  }
  let rows = (TABLES[table]?.() ?? []).filter((r) => matches(r, ops));
  const order = ops.find(([n]) => n === 'order');
  if (order) {
    const asc = order[2]?.ascending !== false;
    rows = [...rows].sort((a, b) => {
      const x = String(a[order[1]] ?? ''), y = String(b[order[1]] ?? '');
      return asc ? x.localeCompare(y) : y.localeCompare(x);
    });
  }
  const select = ops.find(([n]) => n === 'select');
  if (select?.[2]?.head) return { data: null, count: rows.length, error: null };
  const range = ops.find(([n]) => n === 'range');
  if (range) rows = rows.slice(range[1], range[2] + 1);
  const limit = ops.find(([n]) => n === 'limit');
  if (limit) rows = rows.slice(0, limit[1]);
  if (ops.some(([n]) => n === 'maybeSingle' || n === 'single')) return { data: rows[0] ?? null, error: null };
  return { data: rows, count: rows.length, error: null };
}

function builder(table: string, ops: any[][]): any {
  const b: any = {};
  const chain = (name: string) => (...args: any[]) => { ops.push([name, ...args]); return b; };
  for (const m of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'lte', 'or', 'order', 'range', 'limit', 'is', 'upsert', 'insert', 'update', 'maybeSingle', 'single']) b[m] = chain(m);
  b.then = (ok: any, err: any) => Promise.resolve(runQuery(table, ops)).then(ok, err);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => builder(table, []) }),
}));

async function post(body: unknown, key: string | null = KEY.secret) {
  const { POST } = await import('@/app/api/mcp/route');
  const res = await POST(new Request('https://trygroveai.com/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  deliveries = [];
  for (const k of KEYS) { k.calls = 0; k.revoked_at = null; }
  DOMAINS[0].canonical_blog_base = null;
});

describe('handshake', () => {
  it('initializes with a protocol the client asked for', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'claude-code', version: '1' } } });
    expect(r.status).toBe(200);
    expect(r.body.result.protocolVersion).toBe('2025-03-26');
    expect(r.body.result.serverInfo.name).toBe('grove');
    expect(r.body.result.instructions).toContain('pull_new');
  });

  it('answers a notification with 202 and no body', async () => {
    // A response here makes every client log an unsolicited message on connect.
    const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(r.status).toBe(202);
    expect(r.body).toBeNull();
  });

  it('lists tools with schemas and without grove\'s internal scope field', async () => {
    const r = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = r.body.result.tools.map((t: any) => t.name);
    expect(names).toContain('pull_new');
    expect(r.body.result.tools.every((t: any) => t.inputSchema?.type === 'object')).toBe(true);
    expect(r.body.result.tools.every((t: any) => t.scope === undefined)).toBe(true);
  });

  it('answers ping', async () => {
    expect((await post({ jsonrpc: '2.0', id: 3, method: 'ping' })).body.result).toEqual({});
  });

  it('reports an unknown method as method-not-found, not a crash', async () => {
    const r = await post({ jsonrpc: '2.0', id: 4, method: 'tools/delete' });
    expect(r.body.error.code).toBe(-32601);
    expect(r.status).toBe(200);
  });

  it('answers a batch with an array, skipping the notifications in it', async () => {
    const r = await post([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.map((m: any) => m.id)).toEqual([1, 2]);
  });

  it('rejects malformed JSON with a parse error', async () => {
    const r = await post('{not json');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe(-32700);
  });
});

describe('auth', () => {
  it('refuses an anonymous call and says how to authenticate', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('refuses a revoked key', async () => {
    KEYS[0].revoked_at = '2026-01-01T00:00:00Z';
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
  });

  it('refuses a key whose digest is not on file', async () => {
    const stranger = mintKey();
    expect(hashKey(stranger.secret)).not.toBe(KEY.hash);
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, stranger.secret)).status).toBe(401);
  });

  it('records usage against the key that called', async () => {
    await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sites', arguments: {} } });
    expect(KEYS[0].calls).toBe(1);
    expect(KEYS[0].last_tool).toBe('list_sites');
    expect(KEYS[0].last_used_at).toBeTruthy();
  });
});

describe('tools/call', () => {
  it('runs a tool and returns both text and structured content', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sites', arguments: {} } });
    expect(r.body.result.structuredContent.sites[0].site).toBe('acme.com');
    expect(JSON.parse(r.body.result.content[0].text).sites[0].published).toBe(1);
    expect(r.body.result.isError).toBeUndefined();
  });

  it('completes the pull → record → pull loop', async () => {
    const first = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pull_new', arguments: { format: 'mdx' } } });
    const article = first.body.result.structuredContent.articles[0];
    expect(article.filename).toBe('first.mdx');

    await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'record_delivery', arguments: { slug: 'first', url: 'https://acme.com/blog/first' } } });

    const second = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pull_new', arguments: {} } });
    expect(second.body.result.structuredContent.articles).toEqual([]);
    expect(second.body.result.content[0].text).toContain('Nothing new');
  });

  it('refuses a write tool on a read-only key, as a tool error the model can read', async () => {
    const r = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_canonical_base', arguments: { base: 'https://acme.com/blog' } } },
      READ_KEY.secret,
    );
    expect(r.status).toBe(200);
    expect(r.body.result.isError).toBe(true);
    expect(r.body.result.content[0].text).toContain('read-only');
    expect(DOMAINS[0].canonical_blog_base).toBeNull();
  });

  // The asymmetry is deliberate and easy to lose. A read-only KEY gets a tool
  // error it can relay, because there is no step-up in that path and the fix is
  // for the customer to make a new key. A read-only GRANT gets the spec's 403,
  // because a client holding one can ask for more scope and retry.
  it('answers a read-only OAuth grant with a step-up challenge instead', async () => {
    const r = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'set_canonical_base', arguments: { base: 'https://acme.com/blog' } } },
      READ_GRANT,
    );
    expect(r.status).toBe(403);
    const challenge = r.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="posts:read posts:write"');
    // Never invalid_token: the token is fine, it just may not do this.
    expect(challenge).not.toContain('invalid_token');
    expect(DOMAINS[0].canonical_blog_base).toBeNull();
  });

  it('lets the same grant read, so the 403 is about the scope and not the token', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sites', arguments: {} } }, READ_GRANT);
    expect(r.status).toBe(200);
    expect(r.body.result.structuredContent.sites).toHaveLength(1);
  });

  it('needs a tool name', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { arguments: {} } });
    expect(r.body.error.code).toBe(-32602);
  });
});

describe('resources', () => {
  it('lists the integration guide and reads it back as markdown', async () => {
    const list = await post({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    const uri = list.body.result.resources[0].uri;
    expect(uri).toBe('grove://guide/content-layer');

    const read = await post({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri } });
    expect(read.body.result.contents[0].mimeType).toBe('text/markdown');
    expect(read.body.result.contents[0].text).toContain('groveBeacon');
  });

  it('rejects an unknown resource uri', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'grove://secrets' } });
    expect(r.body.error.code).toBe(-32602);
  });
});
