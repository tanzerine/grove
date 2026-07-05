import { describe, it, expect } from 'vitest';
import { buildServiceState, serviceStateMd, relAgo, type ServiceStateInput } from '../lib/analytics/service-state';

const NOW = new Date('2026-07-05T12:00:00Z');

const base: ServiceStateInput = {
  now: NOW,
  posts: { published: 0, inFlight: 0, inReview: 0, scheduled: 0, failed: 0, nextScheduledAt: null, lastPublishedAt: null },
  gsc: { configured: true, connected: false, verified: false, syncedAt: null },
  tracking: { lastEventAt: null, events7d: 0 },
  quality: { avgScore: null, evaluated: 0 },
};

const item = (input: ServiceStateInput, key: string) =>
  buildServiceState(input).items.find((i) => i.key === key)!;

describe('relAgo', () => {
  it('formats minutes, hours and days', () => {
    expect(relAgo('2026-07-05T11:30:00Z', NOW)).toBe('30 min ago');
    expect(relAgo('2026-07-05T06:00:00Z', NOW)).toBe('6 hr ago');
    expect(relAgo('2026-07-02T12:00:00Z', NOW)).toBe('3 d ago');
    expect(relAgo(null, NOW)).toBeNull();
    expect(relAgo('garbage', NOW)).toBeNull();
  });
});

describe('content engine item', () => {
  it('is off when nothing exists', () => {
    const i = item(base, 'pipeline');
    expect(i.level).toBe('off');
    expect(i.value).toBe('Idle');
  });
  it('flags drafts awaiting review', () => {
    const i = item({ ...base, posts: { ...base.posts, published: 5, inReview: 2 } }, 'pipeline');
    expect(i.level).toBe('attention');
    expect(i.value).toBe('5 live');
    expect(i.detail).toContain('2 awaiting your review');
  });
  it('shows next publish when scheduled', () => {
    const i = item({ ...base, posts: { ...base.posts, published: 3, scheduled: 1, nextScheduledAt: '2026-07-07T12:00:00Z' } }, 'pipeline');
    expect(i.level).toBe('ok');
    expect(i.detail).toContain('next publish in 2 d');
  });
  it('flags failures', () => {
    const i = item({ ...base, posts: { ...base.posts, published: 3, failed: 1 } }, 'pipeline');
    expect(i.level).toBe('attention');
    expect(i.detail).toContain('1 failed');
  });
});

describe('search console item', () => {
  it('walks the connect → verify → sync ladder', () => {
    expect(item(base, 'gsc').value).toBe('Not connected');
    expect(item({ ...base, gsc: { ...base.gsc, connected: true } }, 'gsc').value).toBe('Setup incomplete');
    expect(item({ ...base, gsc: { ...base.gsc, connected: true, verified: true } }, 'gsc').value).toBe('Awaiting first sync');
    const fresh = item({ ...base, gsc: { configured: true, connected: true, verified: true, syncedAt: '2026-07-05T09:00:00Z' } }, 'gsc');
    expect(fresh.level).toBe('ok');
    expect(fresh.detail).toContain('3 hr ago');
  });
  it('marks a stale sync', () => {
    const i = item({ ...base, gsc: { configured: true, connected: true, verified: true, syncedAt: '2026-07-01T09:00:00Z' } }, 'gsc');
    expect(i.level).toBe('attention');
    expect(i.value).toBe('Sync stale');
  });
  it('is off when the deployment has no Google creds', () => {
    expect(item({ ...base, gsc: { ...base.gsc, configured: false } }, 'gsc').value).toBe('Unavailable');
  });
});

describe('reader tracking item', () => {
  it('waits quietly before any posts are live', () => {
    expect(item(base, 'tracking').level).toBe('off');
  });
  it('warns when posts are live but no events ever arrived', () => {
    const i = item({ ...base, posts: { ...base.posts, published: 4 } }, 'tracking');
    expect(i.level).toBe('attention');
    expect(i.detail).toContain('embed');
  });
  it('warns when events went quiet this week', () => {
    const i = item({ ...base, tracking: { lastEventAt: '2026-06-20T00:00:00Z', events7d: 0 } }, 'tracking');
    expect(i.level).toBe('attention');
    expect(i.value).toBe('Quiet');
  });
  it('is ok with recent events', () => {
    const i = item({ ...base, tracking: { lastEventAt: '2026-07-05T10:00:00Z', events7d: 132 } }, 'tracking');
    expect(i.level).toBe('ok');
    expect(i.detail).toContain('132 reader events');
  });
});

describe('quality gate item', () => {
  it('is off with no evaluations', () => {
    expect(item(base, 'quality').level).toBe('off');
  });
  it('is ok at or above the 70 bar', () => {
    const i = item({ ...base, quality: { avgScore: 82.4, evaluated: 7 } }, 'quality');
    expect(i.level).toBe('ok');
    expect(i.value).toBe('82/100 avg');
  });
  it('flags averages below the bar', () => {
    const i = item({ ...base, quality: { avgScore: 61, evaluated: 3 } }, 'quality');
    expect(i.level).toBe('attention');
    expect(i.detail).toContain('below the 70 quality bar');
  });
});

describe('serviceStateMd', () => {
  it('renders one line per subsystem for agent prompts', () => {
    const md = serviceStateMd(buildServiceState(base));
    expect(md).toContain('CURRENT SERVICE STATE');
    expect(md.split('\n')).toHaveLength(5);
    expect(md).toContain('- Search Console: Not connected');
  });
});
