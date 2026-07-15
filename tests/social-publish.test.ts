import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the DB + connection lookup so we test the posting orchestration in
// isolation with fully mocked platform APIs (no network, no Supabase).
const { getConnections, updateEq } = vi.hoisted(() => ({
  getConnections: vi.fn(),
  updateEq: vi.fn(async () => ({})),
}));
vi.mock('../lib/social/oauth', () => ({ getConnections }));
vi.mock('../lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: updateEq }) }) }),
}));

import { publishToSocials } from '../lib/social/publish';

const xConn = {
  platform: 'x', account_handle: '@me', account_id: null,
  access_token: 'tok', refresh_token: null, expires_at: null, scopes: null,
};
const liConn = { ...xConn, platform: 'linkedin', account_id: 'urn:li:person:1' };

const post = { id: 'p1', title: 'T', slug: 's', social: { x: 'hello', linkedin: 'hi there' }, social_published: {} };
const domain = { blog_slug: 'demo' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
  delete process.env.SOCIAL_DRY_RUN;
});
afterEach(() => vi.unstubAllGlobals());

describe('publishToSocials', () => {
  it('posts to X and records the tweet id', async () => {
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'tweet1' } }) }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, domain);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://api.twitter.com/2/tweets', expect.anything());
    expect(res.x.id).toBe('tweet1');
    expect(updateEq).toHaveBeenCalled(); // persisted social_published
  });

  it('posts to LinkedIn using the x-restli-id header', async () => {
    getConnections.mockResolvedValue([liConn]);
    const fetchMock = vi.fn(async () => ({
      ok: true, headers: { get: () => 'liPost1' }, json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, domain);
    expect(res.linkedin.id).toBe('liPost1');
  });

  it('DRY RUN: composes but makes no network call', async () => {
    process.env.SOCIAL_DRY_RUN = 'true';
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, domain);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.x.dry_run).toBe(true);
    expect(res.x.id).toBeUndefined();
  });

  it('isolates a platform failure without throwing', async () => {
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn(async () => ({ ok: false, text: async () => 'rate limited' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, domain);
    expect(res.x.error).toContain('rate limited');
    expect(res.x.id).toBeUndefined();
  });

  it('never re-posts a platform that already succeeded', async () => {
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const already = { ...post, social_published: { x: { id: 'old', at: '2026-01-01' } } };
    const res = await publishToSocials('d1', already, domain);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.x.id).toBe('old');
  });

  it('fires the webhook even with zero OAuth connections', async () => {
    getConnections.mockResolvedValue([]); // no connected accounts
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, {
      blog_slug: 'demo', social_webhook_url: 'https://hook.test/x', social_webhook_secret: 'whsec_1',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://hook.test/x', expect.anything());
    expect(res.webhook.status).toBe(200);
    expect(updateEq).toHaveBeenCalled();
  });

  it('only-filter shares just the requested platform', async () => {
    getConnections.mockResolvedValue([xConn, liConn]);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'tweet1' } }) }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await publishToSocials('d1', { ...post }, domain, { only: ['x'] });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://api.twitter.com/2/tweets', expect.anything());
    expect(res.x.id).toBe('tweet1');
    expect(res.linkedin).toBeUndefined();
  });

  it('only-filter skips the webhook unless asked for', async () => {
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { id: 'tweet1' } }) }));
    vi.stubGlobal('fetch', fetchMock);

    const withHook = { blog_slug: 'demo', social_webhook_url: 'https://hook.test/x', social_webhook_secret: 'whsec_1' };
    const res = await publishToSocials('d1', { ...post }, withHook, { only: ['x'] });

    expect(fetchMock).toHaveBeenCalledOnce(); // X only — no webhook delivery
    expect(res.webhook).toBeUndefined();
  });

  it('only-filter can target the webhook alone', async () => {
    getConnections.mockResolvedValue([xConn]);
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const withHook = { blog_slug: 'demo', social_webhook_url: 'https://hook.test/x', social_webhook_secret: 'whsec_1' };
    const res = await publishToSocials('d1', { ...post }, withHook, { only: ['webhook'] });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://hook.test/x', expect.anything());
    expect(res.webhook.status).toBe(200);
    expect(res.x).toBeUndefined();
  });

  it('does not re-fire a webhook that already delivered', async () => {
    getConnections.mockResolvedValue([]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const already = { ...post, social_published: { webhook: { status: 200, at: '2026-01-01' } } };
    const res = await publishToSocials('d1', already, {
      blog_slug: 'demo', social_webhook_url: 'https://hook.test/x', social_webhook_secret: 'whsec_1',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.webhook.status).toBe(200);
  });
});
