import { describe, it, expect } from 'vitest';
import {
  classifySource, trafficSources, answerReferrals, funnel, answerEngineName,
  filterWindow, viewsByDay, postRollup,
  type EventRow,
} from '../lib/analytics/aggregate';

const view = (referrer_host: string | null, session_id = 's', utm_source: string | null = null): EventRow =>
  ({ type: 'view', referrer_host, utm_source, scroll_depth: null, session_id });

describe('classifySource', () => {
  it('routes search engines', () => {
    expect(classifySource('google.com')).toBe('search');
    expect(classifySource('www.google.co.uk')).toBe('search');
    expect(classifySource('bing.com')).toBe('search');
  });
  it('routes answer engines', () => {
    expect(classifySource('chatgpt.com')).toBe('answer');
    expect(classifySource('perplexity.ai')).toBe('answer');
    expect(classifySource('gemini.google.com')).toBe('answer');
  });
  it('treats no referrer as direct', () => {
    expect(classifySource(null)).toBe('direct');
    expect(classifySource('')).toBe('direct');
  });
  it('routes everything else as social/referral', () => {
    expect(classifySource('t.co')).toBe('social');
    expect(classifySource('some-blog.com')).toBe('social');
  });
  it('falls back to utm_source when no referrer', () => {
    expect(classifySource(null, 'newsletter')).toBe('social');
    expect(classifySource(null, 'google')).toBe('search');
  });
});

describe('answerEngineName', () => {
  it('maps hosts to friendly names', () => {
    expect(answerEngineName('chatgpt.com')).toBe('ChatGPT');
    expect(answerEngineName('chat.openai.com')).toBe('ChatGPT');
    expect(answerEngineName('perplexity.ai')).toBe('Perplexity');
    expect(answerEngineName('example.com')).toBeNull();
  });
});

describe('trafficSources', () => {
  it('buckets views into four sources with percentages', () => {
    const events: EventRow[] = [
      view('google.com'), view('google.com'), view('bing.com'), // 3 search
      view('chatgpt.com'),                                       // 1 answer
      view(null),                                                // 1 direct
      view('t.co'),                                              // 1 social
      { type: 'scroll', referrer_host: 'google.com', utm_source: null, scroll_depth: 50, session_id: 's' }, // ignored
    ];
    const { total, sources } = trafficSources(events);
    expect(total).toBe(6);
    const by = Object.fromEntries(sources.map((s) => [s.key, s]));
    expect(by.search.clicks).toBe(3);
    expect(by.search.pct).toBe(50);
    expect(by.answer.clicks).toBe(1);
    expect(by.direct.clicks).toBe(1);
    expect(by.social.clicks).toBe(1);
  });
  it('is empty-safe', () => {
    expect(trafficSources([]).total).toBe(0);
  });
});

describe('answerReferrals', () => {
  it('counts and ranks answer-engine views by engine', () => {
    const events: EventRow[] = [
      view('chatgpt.com'), view('chatgpt.com'), view('perplexity.ai'),
      view('google.com'), // not an answer engine
    ];
    const r = answerReferrals(events);
    expect(r.total).toBe(3);
    expect(r.byEngine[0]).toEqual({ name: 'ChatGPT', count: 2, pct: 67 });
    expect(r.byEngine[1].name).toBe('Perplexity');
  });
});

describe('filterWindow', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  it('keeps events inside the window and drops older ones', () => {
    const events: EventRow[] = [
      { ...view('google.com'), created_at: '2026-07-04T00:00:00Z' },
      { ...view('google.com'), created_at: '2026-06-01T00:00:00Z' },
    ];
    expect(filterWindow(events, 7, now)).toHaveLength(1);
    expect(filterWindow(events, 90, now)).toHaveLength(2);
  });
  it('keeps rows without a timestamp', () => {
    expect(filterWindow([view('google.com')], 7, now)).toHaveLength(1);
  });
});

describe('viewsByDay', () => {
  const now = new Date('2026-07-05T12:00:00Z');
  const at = (iso: string): EventRow => ({ ...view('google.com'), created_at: iso });
  it('buckets views per UTC day and zero-fills gaps up to today', () => {
    const days = viewsByDay([
      at('2026-07-02T03:00:00Z'), at('2026-07-02T20:00:00Z'), at('2026-07-04T09:00:00Z'),
    ], 30, now);
    expect(days.map((d) => d.date)).toEqual(['2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
    expect(days.map((d) => d.views)).toEqual([2, 0, 1, 0]);
  });
  it('ignores non-view events and returns [] when nothing qualifies', () => {
    const scroll: EventRow = { type: 'scroll', referrer_host: null, utm_source: null, scroll_depth: 50, session_id: 's', created_at: '2026-07-04T00:00:00Z' };
    expect(viewsByDay([scroll], 30, now)).toEqual([]);
  });
  it('clips events older than the window', () => {
    const days = viewsByDay([at('2026-01-01T00:00:00Z'), at('2026-07-05T01:00:00Z')], 7, now);
    expect(days).toEqual([{ date: '2026-07-05', views: 1 }]);
  });
});

describe('postRollup', () => {
  it('aggregates views/read50/conversions per post, deduped by session', () => {
    const ev = (post_id: string, type: string, session_id: string, scroll_depth: number | null = null): EventRow =>
      ({ type, referrer_host: null, utm_source: null, scroll_depth, session_id, post_id });
    const rows = postRollup([
      ev('p1', 'view', 'a'), ev('p1', 'view', 'b'), ev('p1', 'scroll', 'a', 75), ev('p1', 'scroll', 'a', 100),
      ev('p1', 'conversion', 'a'),
      ev('p2', 'view', 'c'), ev('p2', 'scroll', 'c', 25),
    ]);
    expect(rows).toEqual([
      { post_id: 'p1', views: 2, read50: 1, conversions: 1 },
      { post_id: 'p2', views: 1, read50: 0, conversions: 0 },
    ]);
  });
});

describe('funnel', () => {
  it('dedupes stages by session', () => {
    const events: EventRow[] = [
      { type: 'view', referrer_host: 'google.com', utm_source: null, scroll_depth: null, session_id: 'a' },
      { type: 'view', referrer_host: 'google.com', utm_source: null, scroll_depth: null, session_id: 'a' }, // dup view
      { type: 'view', referrer_host: 'google.com', utm_source: null, scroll_depth: null, session_id: 'b' },
      { type: 'scroll', referrer_host: null, utm_source: null, scroll_depth: 75, session_id: 'a' },
      { type: 'scroll', referrer_host: null, utm_source: null, scroll_depth: 25, session_id: 'b' }, // below 50
      { type: 'conversion', referrer_host: null, utm_source: null, scroll_depth: null, session_id: 'a' },
    ];
    expect(funnel(events)).toEqual({ clicks: 2, read50: 1, converted: 1 });
  });
});
