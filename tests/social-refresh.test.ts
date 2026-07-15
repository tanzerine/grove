import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture what refreshConnection persists so we can assert the rotated token
// is stored (X invalidates the old refresh token on every use).
const { updateEq, updateSpy } = vi.hoisted(() => {
  const updateEq = vi.fn(async () => ({}));
  const updateSpy = vi.fn(() => ({ eq: () => ({ eq: updateEq }) }));
  return { updateEq, updateSpy };
});
vi.mock('../lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ update: updateSpy }) }),
}));
// Pass tokens through unchanged so assertions read plaintext.
vi.mock('../lib/social/crypto', () => ({
  encryptToken: (t: string) => t,
  decryptToken: (t: string) => t,
}));

import { tokenExpired, refreshConnection, TOKEN_SKEW_MS } from '../lib/social/oauth';

const xConn = {
  platform: 'x' as const, account_handle: '@me', account_id: null,
  access_token: 'old_access', refresh_token: 'old_refresh', expires_at: null, scopes: 'tweet.write',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.X_CLIENT_ID = 'cid';
  process.env.X_CLIENT_SECRET = 'csecret';
});
afterEach(() => vi.unstubAllGlobals());

describe('tokenExpired', () => {
  const now = 1_000_000_000_000;
  it('treats a null expiry as long-lived (never refresh)', () => {
    expect(tokenExpired(null, now)).toBe(false);
  });
  it('is true once past expiry', () => {
    expect(tokenExpired(new Date(now - 1000).toISOString(), now)).toBe(true);
  });
  it('is true within the skew window before expiry', () => {
    expect(tokenExpired(new Date(now + TOKEN_SKEW_MS - 1000).toISOString(), now)).toBe(true);
  });
  it('is false with comfortable time left', () => {
    expect(tokenExpired(new Date(now + TOKEN_SKEW_MS + 60_000).toISOString(), now)).toBe(false);
  });
});

describe('refreshConnection', () => {
  it('refreshes, returns the new access token, and persists the rotated refresh token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: 'new_access', refresh_token: 'new_refresh', expires_in: 7200, scope: 'tweet.write' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const fresh = await refreshConnection('d1', xConn);

    // Called X's token endpoint with a refresh_token grant.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twitter.com/2/oauth2/token');
    expect((init as any).body.toString()).toContain('grant_type=refresh_token');
    expect((init as any).headers.authorization).toMatch(/^Basic /);

    expect(fresh.access_token).toBe('new_access');
    // The rotated refresh token must be the one written back.
    const persisted = updateSpy.mock.calls[0][0] as any;
    expect(persisted.refresh_token).toBe('new_refresh');
    expect(persisted.access_token).toBe('new_access');
    expect(updateEq).toHaveBeenCalled();
  });

  it('keeps the existing refresh token when the provider does not rotate it', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, json: async () => ({ access_token: 'new_access', expires_in: 7200 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const fresh = await refreshConnection('d1', xConn);
    expect(fresh.refresh_token).toBe('old_refresh');
    expect((updateSpy.mock.calls[0][0] as any).refresh_token).toBe('old_refresh');
  });

  it('throws on a failed refresh (dead refresh token → reconnect)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(refreshConnection('d1', xConn)).rejects.toThrow(/token refresh failed/);
  });

  it('no-ops a connection without a refresh token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const noRefresh = { ...xConn, refresh_token: null };
    expect(await refreshConnection('d1', noRefresh)).toBe(noRefresh);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
