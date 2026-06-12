import { describe, it, expect } from 'vitest';
import { composeBrief, nextAction, type BriefStats } from '../lib/agent-brief';

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

describe('composeBrief', () => {
  it('brand-new domain: invites the first topic', () => {
    const out = composeBrief(base);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/No articles yet/);
  });

  it('first drafts in flight, nothing published', () => {
    const out = composeBrief({ ...base, inFlight: 2 }).join(' ');
    expect(out).toContain('drafting your first 2 articles');
  });

  it('drafts waiting for review before first publish', () => {
    const out = composeBrief({ ...base, inReview: 1 }).join(' ');
    expect(out).toContain('1 draft is ready for your review');
  });

  it('growth week: reports reads with an up-percentage and conversions', () => {
    const out = composeBrief({
      ...base,
      totalPublished: 12, publishedThisWeek: 3,
      readsThisWeek: 280, readsLastWeek: 200,
      conversionsThisWeek: 9, organicShare: 0.31,
      topPost: { title: 'How to brew filter coffee', views: 88 },
    }).join(' ');
    expect(out).toContain('3 new articles');
    expect(out).toContain('280 reads — up 40% on last week');
    expect(out).toContain('9 of them clicked through to oveners.com');
    expect(out).toContain('31% of readers');
    expect(out).toContain('How to brew filter coffee');
  });

  it('down week: states the drop plainly', () => {
    const out = composeBrief({
      ...base, totalPublished: 5, readsThisWeek: 50, readsLastWeek: 100,
    }).join(' ');
    expect(out).toContain('down 50% from last week');
  });

  it('flat week reads as steady, not noise', () => {
    const out = composeBrief({
      ...base, totalPublished: 5, readsThisWeek: 101, readsLastWeek: 100,
    }).join(' ');
    expect(out).toContain('steady with last week');
  });

  it('first readers ever: no fake percentage', () => {
    const out = composeBrief({
      ...base, totalPublished: 2, readsThisWeek: 14, readsLastWeek: 0,
    }).join(' ');
    expect(out).toContain('your first readers');
    expect(out).not.toContain('%');
  });

  it('published but silent week: sets expectation instead of blank stats', () => {
    const out = composeBrief({ ...base, totalPublished: 4, publishedThisWeek: 1 }).join(' ');
    expect(out).toContain('No reads recorded this week yet');
    expect(out).toContain('takes a few weeks');
  });
});

describe('nextAction', () => {
  it('points at reviews when drafts wait', () => {
    const a = nextAction({ ...base, inReview: 3 });
    expect(a?.href).toBe('/dashboard/reviews');
    expect(a?.label).toContain('3 waiting drafts');
  });
  it('is null when nothing needs the owner', () => {
    expect(nextAction(base)).toBeNull();
  });
});
