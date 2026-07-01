import { describe, it, expect } from 'vitest';
import { composeDigestEmail, digestChips, readsDelta } from '../lib/email/digest';
import type { BriefStats } from '../lib/agent-brief';

const base: BriefStats = {
  hostname: 'oveners.com',
  publishedThisWeek: 0,
  totalPublished: 0,
  readsThisWeek: 0,
  readsLastWeek: 0,
  conversionsThisWeek: 0,
  organicShare: 0,
  inReview: 0,
  inFlight: 0,
  nextScheduledAt: null,
  topPost: null,
};

const growth: BriefStats = {
  ...base,
  totalPublished: 12,
  publishedThisWeek: 3,
  readsThisWeek: 280,
  readsLastWeek: 200,
  conversionsThisWeek: 9,
  organicShare: 0.31,
  topPost: { title: 'How to brew filter coffee', views: 88 },
};

describe('readsDelta', () => {
  it('reports an up percentage when reads grew', () => {
    expect(readsDelta(growth)).toEqual({ pct: 40, dir: 'up' });
  });
  it('reports down when reads fell', () => {
    expect(readsDelta({ ...base, readsThisWeek: 50, readsLastWeek: 100 })).toEqual({ pct: 50, dir: 'down' });
  });
  it('treats <5% movement as flat', () => {
    expect(readsDelta({ ...base, readsThisWeek: 101, readsLastWeek: 100 })?.dir).toBe('flat');
  });
  it('is null with no prior week or no reads (no fake percentage)', () => {
    expect(readsDelta({ ...base, readsThisWeek: 14, readsLastWeek: 0 })).toBeNull();
    expect(readsDelta(base)).toBeNull();
  });
});

describe('digestChips', () => {
  it('exposes reads, clicks, and published in order', () => {
    const chips = digestChips(growth);
    expect(chips.map((c) => c.label)).toEqual([
      'Reads this week',
      'Clicks to your site',
      'Published this week',
    ]);
    expect(chips[0].value).toBe('280');
    expect(chips[0].sub).toContain('40% vs last week');
    expect(chips[1].value).toBe('9');
    expect(chips[2].value).toBe('3');
  });
  it('labels the first-ever readers instead of a delta', () => {
    const chips = digestChips({ ...base, readsThisWeek: 14, readsLastWeek: 0 });
    expect(chips[0].sub).toBe('your first readers');
  });
});

describe('composeDigestEmail', () => {
  it('carries the brief sentences and a dashboard CTA on a growth week', () => {
    const { subject, html, text } = composeDigestEmail(growth, 'https://app.grove.so/');
    expect(subject).toContain('reads up 40%');
    // brief sentences flow through
    expect(text).toContain('3 new articles');
    expect(text).toContain('280 reads');
    // chips
    expect(html).toContain('Reads this week');
    expect(html).toContain('Clicks to your site');
    // top post
    expect(html).toContain('How to brew filter coffee');
    expect(text).toContain('Top post:');
    // CTA → dashboard (base URL trailing slash collapsed)
    expect(html).toContain('href="https://app.grove.so/dashboard"');
    expect(html).toContain('Open your dashboard');
  });

  it('points the CTA at the reviews queue when drafts are waiting', () => {
    const { subject, html, text } = composeDigestEmail(
      { ...growth, inReview: 2 },
      'https://app.grove.so',
    );
    expect(subject).toContain('2 drafts waiting');
    expect(html).toContain('href="https://app.grove.so/dashboard/pipeline"');
    expect(html).toContain('Review waiting drafts');
    expect(text).toContain('/dashboard/pipeline');
  });

  it('uses an onboarding subject before anything is published', () => {
    const { subject, html } = composeDigestEmail(base, 'https://app.grove.so');
    expect(subject).toContain('getting started');
    // still a valid email with the opt-out footer
    expect(html).toContain('Turn off the weekly digest');
  });

  it('escapes HTML in the hostname and top post title', () => {
    const { html } = composeDigestEmail(
      { ...growth, hostname: 'a&b.com', topPost: { title: 'Tips & <tricks>', views: 5 } },
      'https://app.grove.so',
    );
    expect(html).toContain('a&amp;b.com');
    expect(html).toContain('Tips &amp; &lt;tricks&gt;');
    expect(html).not.toContain('<tricks>');
  });
});
