/**
 * The MCP tools, against a fake database.
 *
 * TWO THINGS ARE PINNED HERE and both are silent when they break.
 *
 * 1. TENANT SCOPING. Every handler runs on the service-role client, which
 *    bypasses RLS — the only thing standing between one customer's key and
 *    another customer's drafts is that each query carries a domain_id resolved
 *    from the key. There is no second line of defence, so a slug lookup that
 *    forgets it is a cross-tenant read, and it would look like a working
 *    feature.
 *
 * 2. THE LEDGER. pull_new is the incremental sync: it must return published
 *    articles the customer's layer has NOT taken yet, oldest first, and must
 *    go quiet once everything is delivered. Get it wrong and an agent looping
 *    "pull, write, record" either re-imports the whole archive on every run or
 *    silently skips articles the customer paid for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── fixtures ───────────────────────────────────────────────────────────────

type Row = Record<string, any>;

const DOMAINS: Row[] = [
  { id: 'd1', user_id: 'u1', hostname: 'acme.com', blog_slug: 'acme-1', canonical_blog_base: null, custom_blog_hostname: null, site_profile: { business: { name: 'Acme' } }, created_at: '2026-01-01' },
  { id: 'd2', user_id: 'u1', hostname: 'other.com', blog_slug: 'other-1', canonical_blog_base: null, custom_blog_hostname: null, site_profile: null, created_at: '2026-01-02' },
  { id: 'd9', user_id: 'u2', hostname: 'rival.com', blog_slug: 'rival-1', canonical_blog_base: null, custom_blog_hostname: null, site_profile: null, created_at: '2026-01-03' },
];

const POSTS: Row[] = [
  { id: 'p1', domain_id: 'd1', status: 'published', slug: 'first', title: 'First post', body_md: '# First post\n\nBody one.', meta_description: 'One.', published_at: '2026-01-10T00:00:00Z', updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-01-09' },
  { id: 'p2', domain_id: 'd1', status: 'published', slug: 'second', title: 'Second post', body_md: '# Second post\n\nBody two.', meta_description: 'Two.', published_at: '2026-02-10T00:00:00Z', updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-02-09' },
  { id: 'p3', domain_id: 'd1', status: 'published', slug: 'third', title: 'Third post', body_md: '# Third post\n\nBody three.', meta_description: 'Three.', published_at: '2026-03-10T00:00:00Z', updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-03-09' },
  { id: 'p4', domain_id: 'd1', status: 'review', slug: 'draft', title: 'A draft', body_md: '# A draft\n\nNot ready.', meta_description: null, published_at: null, updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-04-01' },
  { id: 'p9', domain_id: 'd9', status: 'published', slug: 'rival-secret', title: 'Rival secret', body_md: '# Rival secret\n\nNot yours.', meta_description: null, published_at: '2026-01-05T00:00:00Z', updated_at: null, cover_image_url: null, cover_image_credit: null, created_at: '2026-01-04' },
];

let deliveries: Row[] = [];
let events: Row[] = [];
/** Every table a query touched, so a test can assert nothing unscoped ran. */
let queries: { table: string; ops: any[][] }[] = [];

const TABLES: Record<string, () => Row[]> = {
  domains: () => DOMAINS,
  posts: () => POSTS,
  mcp_deliveries: () => deliveries,
  post_events: () => events,
};

// ── the fake client ────────────────────────────────────────────────────────

function matches(row: Row, ops: any[][]): boolean {
  for (const [name, ...args] of ops) {
    switch (name) {
      case 'eq': if (row[args[0]] !== args[1]) return false; break;
      case 'neq': if (row[args[0]] === args[1]) return false; break;
      case 'is': if ((row[args[0]] ?? null) !== args[1]) return false; break;
      case 'not':
        // `.not('slug', 'is', null)`
        if (args[1] === 'is' && (row[args[0]] ?? null) === args[2]) return false;
        break;
      case 'in': if (!args[1].includes(row[args[0]])) return false; break;
      case 'gte': if (!(String(row[args[0]] ?? '') >= String(args[1]))) return false; break;
      default: break; // select/order/range/limit/or handled elsewhere
    }
  }
  return true;
}

function runQuery(table: string, ops: any[][]): any {
  queries.push({ table, ops });
  const write = ops.find(([n]) => n === 'upsert' || n === 'update' || n === 'insert');

  if (write) {
    const [kind, payload] = write;
    if (kind === 'upsert' || kind === 'insert') {
      if (table === 'mcp_deliveries') {
        deliveries = deliveries.filter((d) => d.post_id !== payload.post_id).concat([{ ...payload }]);
      }
      return { data: payload, error: null };
    }
    // update: apply to matching rows only
    const rows = (TABLES[table]?.() ?? []).filter((r) => matches(r, ops));
    for (const r of rows) Object.assign(r, payload);
    const single = ops.some(([n]) => n === 'maybeSingle' || n === 'single');
    return { data: single ? rows[0] ?? null : rows, error: null };
  }

  let rows = (TABLES[table]?.() ?? []).filter((r) => matches(r, ops));

  const order = ops.find(([n]) => n === 'order');
  if (order) {
    const [, col, opts] = order;
    const asc = opts?.ascending !== false;
    rows = [...rows].sort((a, b) => {
      const x = String(a[col] ?? ''), y = String(b[col] ?? '');
      return asc ? x.localeCompare(y) : y.localeCompare(x);
    });
  }

  const select = ops.find(([n]) => n === 'select');
  if (select?.[2]?.head) return { data: null, count: rows.length, error: null };

  const range = ops.find(([n]) => n === 'range');
  if (range) rows = rows.slice(range[1], range[2] + 1);
  const limit = ops.find(([n]) => n === 'limit');
  if (limit) rows = rows.slice(0, limit[1]);

  if (ops.some(([n]) => n === 'maybeSingle' || n === 'single')) {
    return { data: rows[0] ?? null, count: rows.length, error: null };
  }
  return { data: rows, count: rows.length, error: null };
}

function builder(table: string, ops: any[][]): any {
  const b: any = {};
  const chain = (name: string) => (...args: any[]) => { ops.push([name, ...args]); return b; };
  for (const m of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'lte', 'or', 'order', 'range', 'limit', 'is', 'upsert', 'insert', 'update', 'maybeSingle', 'single']) {
    b[m] = chain(m);
  }
  b.then = (ok: any, err: any) => Promise.resolve(runQuery(table, ops)).then(ok, err);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => builder(table, []) }),
}));

// ── helpers ────────────────────────────────────────────────────────────────

const ALL_SITES = { keyId: 'k1', userId: 'u1', domainId: null, scopes: ['read', 'write'] as any, name: 'test' };
const READ_ONLY = { ...ALL_SITES, scopes: ['read'] as any };
const PINNED_D1 = { ...ALL_SITES, domainId: 'd1' };

async function call(tool: string, args: any, ctx: any = ALL_SITES) {
  const { callTool } = await import('@/lib/mcp/handlers');
  return callTool(tool, args, ctx);
}

const json = (r: any) => r.structuredContent as any;

beforeEach(() => {
  deliveries = [];
  events = [];
  queries = [];
});

// ── scoping ────────────────────────────────────────────────────────────────

describe('tenant scoping', () => {
  it('never returns another account\'s article, even by exact slug', async () => {
    const r = await call('get_post', { slug: 'rival-secret', site: 'acme.com' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('No article');
  });

  it('refuses a site the key does not own, and does not name it back', async () => {
    const r = await call('list_posts', { site: 'rival.com' });
    expect(r.isError).toBe(true);
    // The error lists what the key CAN see; a site it can't must not appear.
    expect(r.content[0].text).toContain('acme.com');
    expect(r.content[0].text).not.toContain('rival-1');
  });

  it('scopes every posts query by domain_id', async () => {
    await call('list_posts', { site: 'acme.com' });
    const postQueries = queries.filter((q) => q.table === 'posts');
    expect(postQueries.length).toBeGreaterThan(0);
    for (const q of postQueries) {
      expect(q.ops.some(([n, col]) => n === 'eq' && col === 'domain_id')).toBe(true);
    }
  });

  it('a pinned key sees only its own site', async () => {
    const r = json(await call('list_sites', {}, PINNED_D1));
    expect(r.sites.map((s: any) => s.site)).toEqual(['acme.com']);
    // …and does not need to name it.
    expect((await call('list_posts', {}, PINNED_D1)).isError).toBeUndefined();
  });

  it('asks which site when the key can see several', async () => {
    const r = await call('list_posts', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('acme.com');
    expect(r.content[0].text).toContain('other.com');
  });

  it('accepts a hostname with www or a scheme, and the site id', async () => {
    for (const site of ['acme.com', 'www.acme.com', 'https://acme.com/blog', 'd1']) {
      const r = await call('list_posts', { site });
      expect(r.isError, `site=${site}`).toBeUndefined();
      expect(json(r).site).toBe('acme.com');
    }
  });
});

// ── the sync ledger ────────────────────────────────────────────────────────

describe('pull_new', () => {
  it('returns published articles oldest first, so a loop walks the backlog', async () => {
    const r = json(await call('pull_new', { site: 'acme.com', limit: 10 }));
    expect(r.articles.map((a: any) => a.slug)).toEqual(['first', 'second', 'third']);
  });

  it('never hands over a draft', async () => {
    const r = json(await call('pull_new', { site: 'acme.com', limit: 10 }));
    expect(r.articles.map((a: any) => a.slug)).not.toContain('draft');
  });

  it('skips what has already been delivered', async () => {
    deliveries = [{ domain_id: 'd1', post_id: 'p1', external_url: 'https://acme.com/blog/first', delivered_at: '2026-05-01' }];
    const r = json(await call('pull_new', { site: 'acme.com', limit: 10 }));
    expect(r.articles.map((a: any) => a.slug)).toEqual(['second', 'third']);
  });

  it('goes quiet once everything is delivered', async () => {
    deliveries = POSTS.filter((p) => p.domain_id === 'd1' && p.status === 'published')
      .map((p) => ({ domain_id: 'd1', post_id: p.id, delivered_at: '2026-05-01' }));
    const r = await call('pull_new', { site: 'acme.com' });
    expect(r.content[0].text).toContain('Nothing new');
    expect(json(r).articles).toEqual([]);
  });

  it('reports how many are left so an agent knows to loop again', async () => {
    const r = json(await call('pull_new', { site: 'acme.com', limit: 1 }));
    expect(r.articles).toHaveLength(1);
    expect(r.remaining).toBe(2);
    expect(r.next_step).toContain('record_delivery');
  });

  it('formats the body for the layer and carries the beacon ids', async () => {
    const r = json(await call('pull_new', { site: 'acme.com', limit: 1, format: 'mdx' }));
    const a = r.articles[0];
    expect(a.filename).toBe('first.mdx');
    expect(a.content).toContain('slug: "first"');
    expect(a.content).toContain('Body one.');
    // The title is a frontmatter field; repeating it in the body prints twice.
    expect(a.content).not.toContain('# First post');
    // Without these two ids on the page, grove's reporting goes blind.
    expect(a.analytics.post_id).toBe('p1');
    expect(a.analytics.domain_id).toBe('d1');
  });
});

describe('record_delivery', () => {
  it('records the live URL and makes the next pull skip it', async () => {
    const r = json(await call('record_delivery', { site: 'acme.com', slug: 'first', url: 'https://acme.com/blog/first', layer: 'mdx' }));
    expect(r.recorded.slug).toBe('first');
    expect(r.recorded.url).toBe('https://acme.com/blog/first');
    const next = json(await call('pull_new', { site: 'acme.com', limit: 10 }));
    expect(next.articles.map((a: any) => a.slug)).toEqual(['second', 'third']);
  });

  it('is safe to call twice — a retried batch must not duplicate', async () => {
    await call('record_delivery', { site: 'acme.com', slug: 'first', url: 'https://acme.com/blog/first' });
    await call('record_delivery', { site: 'acme.com', slug: 'first', url: 'https://acme.com/blog/first-v2' });
    expect(deliveries.filter((d) => d.post_id === 'p1')).toHaveLength(1);
    expect(deliveries[0].external_url).toBe('https://acme.com/blog/first-v2');
  });

  it('rejects a URL that is not absolute http(s)', async () => {
    const r = await call('record_delivery', { site: 'acme.com', slug: 'first', url: '/blog/first' });
    expect(r.isError).toBe(true);
    expect(deliveries).toHaveLength(0);
  });

  it('nudges toward canonical while grove is still the canonical copy', async () => {
    const r = json(await call('record_delivery', { site: 'acme.com', slug: 'first', url: 'https://acme.com/blog/first' }));
    expect(r.hint).toContain('set_canonical_base');
  });

  it('needs a write key', async () => {
    const r = await call('record_delivery', { site: 'acme.com', slug: 'first', url: 'https://acme.com/blog/first' }, READ_ONLY);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('read-only');
    expect(deliveries).toHaveLength(0);
  });
});

describe('set_canonical_base', () => {
  beforeEach(() => { DOMAINS[0].canonical_blog_base = null; });

  it('normalises and stores the base', async () => {
    const r = json(await call('set_canonical_base', { site: 'acme.com', base: 'https://acme.com/blog/' }));
    expect(r.canonical_base).toBe('https://acme.com/blog');
    expect(DOMAINS[0].canonical_blog_base).toBe('https://acme.com/blog');
  });

  it('refuses a base that is not a usable URL', async () => {
    const r = await call('set_canonical_base', { site: 'acme.com', base: 'not a url' });
    expect(r.isError).toBe(true);
    expect(DOMAINS[0].canonical_blog_base).toBeNull();
  });

  it('needs a write key', async () => {
    const r = await call('set_canonical_base', { site: 'acme.com', base: 'https://acme.com/blog' }, READ_ONLY);
    expect(r.isError).toBe(true);
    expect(DOMAINS[0].canonical_blog_base).toBeNull();
  });

  it('moves every URL grove emits for that article', async () => {
    await call('set_canonical_base', { site: 'acme.com', base: 'https://acme.com/blog' });
    const r = json(await call('get_post', { site: 'acme.com', slug: 'first' }));
    // The imported file must not disagree with the rel=canonical grove is
    // emitting elsewhere for the same article.
    expect(r.article.canonical_url).toBe('https://acme.com/blog/first');
    expect(r.content).toContain('canonical: "https://acme.com/blog/first"');
  });
});

// ── reads ──────────────────────────────────────────────────────────────────

describe('list_posts', () => {
  it('returns published cards without bodies', async () => {
    const r = json(await call('list_posts', { site: 'acme.com' }));
    expect(r.posts.map((p: any) => p.slug).sort()).toEqual(['first', 'second', 'third']);
    for (const p of r.posts) expect(p).not.toHaveProperty('body_md');
  });

  it('can show drafts, but only when asked for them by name', async () => {
    const published = json(await call('list_posts', { site: 'acme.com' }));
    expect(published.posts.map((p: any) => p.slug)).not.toContain('draft');
    const review = json(await call('list_posts', { site: 'acme.com', status: 'review' }));
    expect(review.posts.map((p: any) => p.slug)).toEqual(['draft']);
  });

  it('marks which articles are already on the customer\'s layer', async () => {
    deliveries = [{ domain_id: 'd1', post_id: 'p1', external_url: 'https://acme.com/blog/first', delivered_at: '2026-05-01' }];
    const r = json(await call('list_posts', { site: 'acme.com' }));
    const first = r.posts.find((p: any) => p.slug === 'first');
    expect(first.delivered.url).toBe('https://acme.com/blog/first');
    const second = r.posts.find((p: any) => p.slug === 'second');
    expect(second.delivered).toBeNull();
  });

  it('filters to what is still missing from the layer', async () => {
    deliveries = [{ domain_id: 'd1', post_id: 'p1', external_url: null, delivered_at: '2026-05-01' }];
    const r = json(await call('list_posts', { site: 'acme.com', delivered: false }));
    expect(r.posts.map((p: any) => p.slug).sort()).toEqual(['second', 'third']);
  });

  it('rejects a malformed since instead of silently ignoring it', async () => {
    const r = await call('list_posts', { site: 'acme.com', since: 'last tuesday' });
    expect(r.isError).toBe(true);
  });
});

describe('get_post', () => {
  it('returns the article, its SEO metadata and the beacon ids', async () => {
    const r = json(await call('get_post', { site: 'acme.com', slug: 'second', format: 'md' }));
    expect(r.article.grove_id).toBe('p2');
    expect(r.article.author).toBe('Acme Team');
    expect(r.article.json_ld['@graph']).toBeTruthy();
    expect(r.article.analytics).toEqual({ post_id: 'p2', domain_id: 'd1', endpoint: expect.stringContaining('/api/track') });
    expect(r.file.filename).toBe('second.md');
    expect(r.content).toContain('Body two.');
  });

  it('can be looked up by grove_id', async () => {
    const r = json(await call('get_post', { site: 'acme.com', id: 'p3' }));
    expect(r.article.slug).toBe('third');
  });

  it('says so plainly when the slug does not exist', async () => {
    const r = await call('get_post', { site: 'acme.com', slug: 'nope' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('nope');
  });

  it('needs a slug or an id', async () => {
    expect((await call('get_post', { site: 'acme.com' })).isError).toBe(true);
  });
});

describe('list_sites', () => {
  it('counts what is published, delivered and still owed', async () => {
    deliveries = [{ domain_id: 'd1', post_id: 'p1', delivered_at: '2026-05-01' }];
    const r = json(await call('list_sites', {}));
    const acme = r.sites.find((s: any) => s.site === 'acme.com');
    expect(acme.published).toBe(3);
    expect(acme.delivered_to_your_layer).toBe(1);
    expect(acme.awaiting_delivery).toBe(2);
  });
});

describe('post_analytics', () => {
  it('counts readers by session, not by raw beacon', async () => {
    events = [
      { type: 'view', session_id: 's1', referrer_host: 'google.com', utm_source: null, scroll_depth: null, dwell_ms: null, domain_id: 'd1', post_id: 'p1', created_at: '2026-08-01' },
      { type: 'dwell', session_id: 's1', referrer_host: 'google.com', utm_source: null, scroll_depth: null, dwell_ms: 30000, domain_id: 'd1', post_id: 'p1', created_at: '2026-08-01' },
      { type: 'scroll', session_id: 's1', referrer_host: 'google.com', utm_source: null, scroll_depth: 75, dwell_ms: null, domain_id: 'd1', post_id: 'p1', created_at: '2026-08-01' },
      { type: 'view', session_id: 's2', referrer_host: 'chatgpt.com', utm_source: null, scroll_depth: null, dwell_ms: null, domain_id: 'd1', post_id: 'p1', created_at: '2026-08-01' },
    ];
    const r = json(await call('post_analytics', { site: 'acme.com' }));
    // One engaged reader firing three beacons is one reader.
    expect(r.readers).toBe(2);
    expect(r.pageviews).toBe(2);
    expect(r.read_past_half).toBe(1);
    expect(r.avg_seconds_on_page).toBe(30);
  });

  it('explains an empty window rather than reporting a flat zero', async () => {
    const r = json(await call('post_analytics', { site: 'acme.com' }));
    expect(r.readers).toBe(0);
    // A customer whose beacon was never wired up sees zeros forever otherwise.
    expect(r.note).toContain('beacon');
  });
});

describe('integration_guide', () => {
  it('leads with the beacon and the canonical, in the stack that was asked for', async () => {
    const r = await call('integration_guide', { stack: 'next-mdx' }, PINNED_D1);
    const text = r.content[0].text;
    expect(text).toContain('groveBeacon');
    expect(text).toContain('set_canonical_base');
    expect(text).toContain('Next.js + MDX');
    expect(text).toContain('acme.com');
  });
});

describe('dispatch', () => {
  it('reports an unknown tool as a tool failure, not a crash', async () => {
    const r = await call('delete_everything', {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Unknown tool');
  });

  it('rejects bad argument types with a message the model can act on', async () => {
    const r = await call('list_posts', { site: 'acme.com', limit: 'lots' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('limit');
  });
});
