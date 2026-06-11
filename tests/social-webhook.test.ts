import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { buildWebhookPayload, signPayload, deliverWebhook } from '../lib/social/webhook';

const post = {
  id: 'p1', title: 'My Post', slug: 'my-post',
  social: { x: 'hook line', linkedin: 'pro take' },
  cover_image_url: 'https://img/cover.webp',
  social_published: {},
};
const domain = { blog_slug: 'demo' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GROVE_BLOG_ROOT_DOMAIN = 'grove.so';
  delete process.env.SOCIAL_DRY_RUN;
});
afterEach(() => vi.unstubAllGlobals());

describe('buildWebhookPayload', () => {
  it('carries the post, canonical url, and per-platform copy', () => {
    const p = buildWebhookPayload(post, domain, 'https://demo.grove.so/my-post');
    expect(p.event).toBe('post.published');
    expect(p.post.url).toBe('https://demo.grove.so/my-post');
    expect(p.post.cover_image_url).toBe('https://img/cover.webp');
    expect(p.domain.blog_slug).toBe('demo');
    // ready-to-post copy for each network
    expect(p.shares.x.text).toContain('hook line');
    expect(p.shares.linkedin.text).toContain('pro take');
    expect(p.shares.instagram.imageUrl).toBe('https://img/cover.webp');
  });
});

describe('signPayload', () => {
  it('is a deterministic sha256 HMAC of the body', () => {
    const body = '{"a":1}';
    const expected = 'sha256=' + createHmac('sha256', 'whsec_x').update(body).digest('hex');
    expect(signPayload(body, 'whsec_x')).toBe(expected);
  });
});

describe('deliverWebhook', () => {
  it('returns null when no url is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await deliverWebhook(post, domain, { url: null, secret: 's' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a signed payload and records the status', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await deliverWebhook(post, domain, { url: 'https://hook.test/x', secret: 'whsec_abc' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, any];
    expect(url).toBe('https://hook.test/x');
    // signature header present and matches the exact body sent
    const sig = opts.headers['x-grove-signature'];
    expect(sig).toBe(signPayload(opts.body, 'whsec_abc'));
    expect(res?.status).toBe(200);
    expect(res?.error).toBeUndefined();
  });

  it('omits the signature header when no secret is set', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await deliverWebhook(post, domain, { url: 'https://hook.test/x', secret: null });
    const opts = (fetchMock.mock.calls[0] as any[])[1];
    expect(opts.headers['x-grove-signature']).toBeUndefined();
  });

  it('records an error (never throws) on a non-2xx response', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await deliverWebhook(post, domain, { url: 'https://hook.test/x', secret: 's' });
    expect(res?.error).toContain('500');
  });

  it('records an error (never throws) when fetch rejects', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    vi.stubGlobal('fetch', fetchMock);
    const res = await deliverWebhook(post, domain, { url: 'https://hook.test/x', secret: 's' });
    expect(res?.error).toContain('ECONNREFUSED');
  });

  it('DRY RUN: builds the payload but makes no network call', async () => {
    process.env.SOCIAL_DRY_RUN = 'true';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await deliverWebhook(post, domain, { url: 'https://hook.test/x', secret: 's' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res?.dry_run).toBe(true);
  });
});
