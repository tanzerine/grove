import { describe, it, expect } from 'vitest';
import {
  REPORTS, getReport, rankingTop50, articleSearches, winnableKeywords, winnableCount,
  maxRecommendedKd, reportSignupHref, formatReportDate, type ProspectReport,
} from '../lib/reports';

const base: ProspectReport = {
  slug: 'acme-abc123',
  domain: 'acme.com',
  researchedOn: '2026-11-06',
  preparedBy: 'Tae',
  currentRanks: [
    { keyword: 'acme', volume: 100, position: 12, path: '/' },
    { keyword: 'acme pricing', volume: 50, position: 64, path: '/pricing/' },
  ],
  peers: ['a.com'],
  articles: [
    { title: 'A', target: { keyword: 'alpha', volume: 300, kd: 4 }, also: [{ keyword: 'alphas', volume: 300, kd: 9 }], why: 'x' },
    { title: 'B', target: { keyword: 'beta', volume: 200, kd: 18 }, why: 'y' },
  ],
  retargets: [
    { path: '/b/', target: { keyword: 'beta', volume: 200, kd: 18 }, change: 'z' },
    { path: '/g/', target: { keyword: 'gamma', volume: 900, kd: 22 }, change: 'z' },
  ],
  skips: [],
  trust: [],
  source: 'test',
};

describe('prospect report math', () => {
  it('counts only top-50 positions as ranking', () => {
    expect(rankingTop50(base)).toBe(1);
  });

  it('sums one figure per article, never the spelling variants', () => {
    expect(articleSearches(base)).toBe(500);
  });

  it('dedupes keywords across articles, variants and retargets', () => {
    expect(winnableKeywords(base).map((k) => k.keyword)).toEqual(['alpha', 'alphas', 'beta', 'gamma']);
    expect(winnableCount(base)).toBe(4);
  });

  it('states the hardest recommended keyword from the data', () => {
    expect(maxRecommendedKd(base)).toBe(22);
  });
});

describe('report links and dates', () => {
  it('pre-fills the domain and tags the campaign for first-touch attribution', () => {
    const href = reportSignupHref(base);
    const q = new URL(href, 'https://x.test').searchParams;
    expect(href.startsWith('/signup?')).toBe(true);
    expect(q.get('domain')).toBe('acme.com');
    expect(q.get('utm_source')).toBe('report');
    expect(q.get('utm_campaign')).toBe('acme-abc123');
  });

  it('formats the research date in UTC so the day never shifts', () => {
    expect(formatReportDate('2026-11-06')).toBe('November 6, 2026');
  });
});

describe('published reports', () => {
  it('resolves by slug and rejects unknown slugs', () => {
    for (const r of REPORTS) expect(getReport(r.slug)).toBe(r);
    expect(getReport('nope')).toBeNull();
  });

  it('never uses a guessable slug', () => {
    for (const r of REPORTS) expect(r.slug).toMatch(/-[0-9a-f]{6}$/);
  });

  it('keeps every recommendation inside what a new domain can win', () => {
    for (const r of REPORTS) {
      expect(maxRecommendedKd(r)).toBeLessThanOrEqual(30);
      for (const a of r.articles) expect(a.target.volume).toBeGreaterThan(0);
    }
  });
});
