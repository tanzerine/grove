import { describe, it, expect } from 'vitest';
import {
  shareOutcome,
  isAuthError,
  connectionHealth,
  latestChannelErrors,
  EXPIRY_WARNING_MS,
} from '../lib/social/health';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const inDays = (n: number) => new Date(NOW + n * 24 * 3600_000).toISOString();

describe('shareOutcome', () => {
  it('counts a record with an id as posted', () => {
    expect(shareOutcome({ id: '1789', at: inDays(0) })).toBe('posted');
  });

  it('does NOT count a failed record as posted', () => {
    // The whole point: the dashboard treated any record as success, so a
    // permanently broken channel showed a green "Posted".
    expect(shareOutcome({ at: inDays(0), error: 'X authorization expired' })).toBe('failed');
  });

  it('reads the webhook’s status code rather than an id', () => {
    expect(shareOutcome({ at: inDays(0), status: 200 })).toBe('posted');
    expect(shareOutcome({ at: inDays(0), status: 500 })).toBe('failed');
  });

  it('keeps dry-run distinct from a real post', () => {
    expect(shareOutcome({ at: inDays(0), dry_run: true })).toBe('dry_run');
  });

  it('treats a missing record as pending, not failed', () => {
    expect(shareOutcome(null)).toBe('pending');
    expect(shareOutcome(undefined)).toBe('pending');
  });
});

describe('isAuthError', () => {
  it('matches the sentences the publisher writes for dead authorizations', () => {
    expect(isAuthError('X authorization expired — reconnect X in Social settings.')).toBe(true);
    expect(isAuthError('LinkedIn author URN missing — reconnect')).toBe(true);
  });

  it('matches raw provider vocabulary that reaches us verbatim', () => {
    expect(isAuthError('401 Unauthorized')).toBe(true);
    expect(isAuthError('{"error":"invalid_grant"}')).toBe(true);
    expect(isAuthError('token has been revoked')).toBe(true);
  });

  it('does not call a quota or rate-limit failure an auth problem', () => {
    // Reconnecting a working account fixes nothing and teaches the owner to
    // ignore the badge. X's 402 is the recurring real-world case.
    expect(isAuthError('X posting quota reached — your X API plan is out of write credits.')).toBe(false);
    expect(isAuthError('X rate limit hit — wait a bit and retry.')).toBe(false);
  });

  it('is false for nothing at all', () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError('')).toBe(false);
  });
});

describe('connectionHealth', () => {
  it('is ok for a fresh refreshable connection', () => {
    const h = connectionHealth({ expiresAt: inDays(0.05), canRefresh: true }, NOW);
    expect(h.state).toBe('ok');
    expect(h.needsReconnect).toBe(false);
  });

  it('never marks a refreshable token as expiring, however short-lived', () => {
    // X access tokens live ~2h and renew unattended — counting them down would
    // paint a healthy channel red several times a day.
    const h = connectionHealth({ expiresAt: inDays(-1), canRefresh: true }, NOW);
    expect(h.state).toBe('ok');
  });

  it('flags a revoked refresh token from the failed post alone', () => {
    // The X case: no expiry tells you anything, the 401 is the only signal.
    const h = connectionHealth({
      expiresAt: inDays(0.05), canRefresh: true,
      lastError: 'X authorization expired — reconnect X in Social settings.',
    }, NOW);
    expect(h.state).toBe('failing');
    expect(h.needsReconnect).toBe(true);
  });

  it('reports a non-auth failure without demanding a reconnect', () => {
    const h = connectionHealth({
      expiresAt: null, canRefresh: true,
      lastError: 'X posting quota reached — your X API plan is out of write credits.',
    }, NOW);
    expect(h.state).toBe('failing');
    expect(h.needsReconnect).toBe(false);
    expect(h.detail).toContain('quota');
  });

  it('warns BEFORE a non-refreshable token lapses', () => {
    // LinkedIn's 60-day token: knowable in advance, so the owner hears about it
    // before a post is lost rather than after.
    const h = connectionHealth({ expiresAt: inDays(3), canRefresh: false }, NOW);
    expect(h.state).toBe('expiring');
    expect(h.label).toBe('Expires in 3 days');
    expect(h.needsReconnect).toBe(true);
  });

  it('stays quiet while a non-refreshable token is still comfortably valid', () => {
    const h = connectionHealth({ expiresAt: inDays(45), canRefresh: false }, NOW);
    expect(h.state).toBe('ok');
  });

  it('warns exactly at the window edge', () => {
    const edge = new Date(NOW + EXPIRY_WARNING_MS).toISOString();
    expect(connectionHealth({ expiresAt: edge, canRefresh: false }, NOW).state).toBe('expiring');
  });

  it('marks a lapsed non-refreshable token expired', () => {
    const h = connectionHealth({ expiresAt: inDays(-1), canRefresh: false }, NOW);
    expect(h.state).toBe('expired');
    expect(h.needsReconnect).toBe(true);
  });

  it('is ok when the provider gave no expiry and nothing has failed', () => {
    const h = connectionHealth({ expiresAt: null, canRefresh: false }, NOW);
    expect(h.state).toBe('ok');
  });

  it('ignores an unparseable expiry rather than crying wolf', () => {
    const h = connectionHealth({ expiresAt: 'not-a-date', canRefresh: false }, NOW);
    expect(h.state).toBe('ok');
  });
});

describe('latestChannelErrors', () => {
  it('surfaces the most recent error per platform', () => {
    const errs = latestChannelErrors([
      { social_published: { x: { at: inDays(0), error: '401 Unauthorized' } } },
      { social_published: { x: { id: '1', at: inDays(-1) } } },
    ]);
    expect(errs.x).toBe('401 Unauthorized');
  });

  it('lets a newer success clear an older failure', () => {
    // Owner pressed Retry, or reconnected — the badge must not stick forever.
    const errs = latestChannelErrors([
      { social_published: { x: { id: '2', at: inDays(0) } } },
      { social_published: { x: { at: inDays(-1), error: '401 Unauthorized' } } },
    ]);
    expect(errs.x).toBeUndefined();
  });

  it('keeps platforms independent', () => {
    const errs = latestChannelErrors([
      { social_published: { x: { id: '2', at: inDays(0) }, linkedin: { at: inDays(0), error: 'boom' } } },
    ]);
    expect(errs.x).toBeUndefined();
    expect(errs.linkedin).toBe('boom');
  });

  it('skips past posts that never recorded a verdict for a channel', () => {
    const errs = latestChannelErrors([
      { social_published: {} },
      { social_published: null },
      { social_published: { linkedin: { at: inDays(-2), error: 'token expired' } } },
    ]);
    expect(errs.linkedin).toBe('token expired');
  });

  it('is empty when nothing has been shared', () => {
    expect(latestChannelErrors([])).toEqual({});
  });
});
