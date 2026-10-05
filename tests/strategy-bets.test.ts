import { describe, it, expect } from 'vitest';
import { gradeBet, formatBetsForPrompt, queryHitsTarget, type BetInput } from '../lib/strategy/bets';
import { digestReport } from '../lib/strategy/build';
import { isBrandQuery, hostLabel } from '../lib/strategy/seeds';
import type { MonthlyReport } from '../lib/strategy/review';

/**
 * The planner used to get no record of whether its own targets worked, so it
 * re-guessed every month. These pin the two inputs that replace the guess: the
 * graded ledger, and a report digest that no longer calls a site's own name
 * "proven demand". Fixtures are trygroveai.com's real Search Console rows.
 */

const NOW = new Date('2026-10-05T00:00:00Z');
const BRANDS = ['Grove', 'trygroveai'];

const bet = (o: Partial<BetInput> = {}): BetInput => ({
  postId: 'p1',
  title: 'Topical Authority SEO: What We Learned',
  publishedAt: '2026-08-27T09:00:00Z',
  targetKeyword: 'topical authority',
  pageImpressions: 0,
  pageClicks: 0,
  queries: [],
  ...o,
});

describe('isBrandQuery', () => {
  it('catches the brand, its host label, and short typos of it', () => {
    for (const q of ['grove ai', 'groveai', 'grove.ai', 'ai grove', 'grove ia', 'groce ai', 'grobe ai', 'goove ai', 'trygroveai']) {
      expect(isBrandQuery(q, BRANDS), q).toBe(true);
    }
  });

  it('leaves real topic queries alone', () => {
    for (const q of ['solid seo in only 2 hours per week', 'hub spoke content strategy ai citations', 'seo driver', 'oliviacal.com']) {
      expect(isBrandQuery(q, BRANDS), q).toBe(false);
    }
  });

  it('does not fuzz short brand words or long queries', () => {
    expect(isBrandQuery('even ai', ['Oven AI'])).toBe(false);                 // "oven" is too short to fuzz
    expect(isBrandQuery('how i drove traffic to my saas', BRANDS)).toBe(false); // > 3 words
  });

  it('reads the registrable label off a hostname', () => {
    expect(hostLabel('www.trygroveai.com')).toBe('trygroveai');
    expect(hostLabel('oveners.com')).toBe('oveners');
    expect(hostLabel(undefined)).toBe('');
  });
});

describe('queryHitsTarget', () => {
  it('counts a query that contains every word of the target or a cluster phrase', () => {
    expect(queryHitsTarget('topical authority seo', ['topical authority'])).toBe(true);
    expect(queryHitsTarget('what is a topical map', ['topical authority', 'topical map'])).toBe(true);
    expect(queryHitsTarget('seo tools', ['seo for solo founders'])).toBe(false);
  });
});

describe('gradeBet', () => {
  it('waits four weeks before judging', () => {
    expect(gradeBet(bet({ publishedAt: '2026-09-20T00:00:00Z' }), NOW, BRANDS).verdict).toBe('too_early');
  });

  it('grades by where the target queries sit, impression-weighted', () => {
    const g = gradeBet(bet({
      pageImpressions: 30,
      queries: [
        { query: 'topical authority', impressions: 10, clicks: 0, position: 8 },
        { query: 'topical authority seo', impressions: 10, clicks: 0, position: 14 },
        { query: 'content hubs', impressions: 10, clicks: 0, position: 3 },
      ],
    }), NOW, BRANDS);
    expect(g.verdict).toBe('close');
    expect(g.target).toEqual({ impressions: 20, position: 11 });
  });

  it('separates "shown for something else" from "not shown at all"', () => {
    const elsewhere = gradeBet(bet({
      targetKeyword: 'seo for solo founders',
      pageImpressions: 1,
      queries: [{ query: 'solid seo in only 2 hours per week', impressions: 1, clicks: 0, position: 22 }],
    }), NOW, BRANDS);
    expect(elsewhere.verdict).toBe('elsewhere');
    expect(elsewhere.shownFor?.query).toBe('solid seo in only 2 hours per week');

    expect(gradeBet(bet(), NOW, BRANDS).verdict).toBe('unseen');
  });

  it('calls a slot aimed at the business name what it is, however it ranked', () => {
    const g = gradeBet(bet({
      targetKeyword: 'grove ai review',
      pageImpressions: 19,
      queries: [{ query: 'grove ai review', impressions: 19, clicks: 1, position: 11 }],
    }), NOW, BRANDS);
    expect(g.verdict).toBe('brand');
  });
});

describe('formatBetsForPrompt', () => {
  it('is empty with no bets, so the block is omitted', () => {
    expect(formatBetsForPrompt([])).toBe('');
  });

  it('spells out that nothing reached the top 20 when nothing did', () => {
    const out = formatBetsForPrompt([
      gradeBet(bet({ targetKeyword: 'keyword research for founders' }), NOW, BRANDS),
      gradeBet(bet({ targetKeyword: 'grove ai alternatives' }), NOW, BRANDS),
      gradeBet(bet({ targetKeyword: 'blog not ranking', publishedAt: '2026-09-16T00:00:00Z' }), NOW, BRANDS),
    ], { asOf: '2026-10-05' });
    expect(out).toContain('WHAT WE ALREADY TRIED');
    expect(out).toContain('SCORECARD (2 old enough to judge): 0 top 10');
    expect(out).toContain('NOT SHOWN  "keyword research for founders"');
    expect(out).toContain('OWN NAME  "grove ai alternatives"');
    expect(out).toContain('None of these reached the top 20');
    expect(out).toContain('Plan none this month');
    expect(out).toContain('TOO NEW (don\'t re-target either): "blog not ranking"');
  });

  it('offers a query Google matched us to as a lead only when it is named and reachable', () => {
    const elsewhere = (query: string, position: number) => gradeBet(bet({
      targetKeyword: 'seo for side projects',
      pageImpressions: 4,
      queries: [{ query, impressions: 1, clicks: 0, position }],
    }), NOW, BRANDS);
    expect(formatBetsForPrompt([elsewhere('solid seo in only 2 hours per week', 22)]))
      .toContain('without being asked: "solid seo in only 2 hours per week" (pos 22)');
    expect(formatBetsForPrompt([elsewhere('oliviacal.com', 45.5)])).not.toContain('without being asked');
    // A brand query is never offered as what the page was "shown for".
    expect(elsewhere('groveai', 9).shownFor).toBeNull();
  });

  it('names the targets that did reach the top 20 as the size this domain can win', () => {
    const out = formatBetsForPrompt([
      gradeBet(bet({
        targetKeyword: 'embed blog on website',
        pageImpressions: 4,
        queries: [{ query: 'embed blog on website', impressions: 4, clicks: 0, position: 6.8 }],
      }), NOW, BRANDS),
    ]);
    expect(out).toContain('TOP 10  "embed blog on website"');
    expect(out).toContain('reached the top 20, which is the size of keyword this domain can win today: "embed blog on website"');
    expect(out).not.toContain('None of these reached');
  });
});

describe('digestReport brand split', () => {
  const report: MonthlyReport = {
    month: '2026-09',
    posts_count: 6,
    totals: {
      views: 40, unique_sessions: 30, median_dwell_sec: 60, scroll_completion_rate: 0.3,
      outbound_to_product_rate: 0.05, conversions: 0, organic_share: 0.5,
    },
    per_pillar: {},
    per_intent: {} as MonthlyReport['per_intent'],
    top_posts: [],
    bottom_posts: [],
    top_referrers: [],
    top_queries: [{ query: 'grove ai', sessions: 3 }, { query: 'seo driver', sessions: 1 }],
    search_console: {
      impressions: 477, clicks: 17, ctr: 0.036, avgPosition: 9, queryCount: 16,
      topQueries: [
        { query: 'grove ai', impressions: 207, clicks: 2, position: 7.4 },
        { query: 'groce ai', impressions: 14, clicks: 0, position: 5.6 },
        { query: 'groveai', impressions: 6, clicks: 0, position: 7.3 },
        { query: 'solid seo in only 2 hours per week', impressions: 1, clicks: 0, position: 22 },
      ],
      nearWinners: [],
    },
  };

  it('moves brand searches out of "proven demand" and says they are not demand', () => {
    const out = digestReport(report, BRANDS);
    const demand = out.split('\n').find((l) => l.startsWith('GSC QUERIES YOU ALREADY RANK FOR'))!;
    expect(demand).toContain('solid seo in only 2 hours per week');
    expect(demand).not.toContain('grove ai');
    expect(demand).not.toContain('groce ai');
    expect(out).toContain('BRAND SEARCHES — 227 of those impressions');
    expect(out).toContain('plan no slot for these queries');
    const real = out.split('\n').find((l) => l.startsWith('REAL SEARCH QUERIES'))!;
    expect(real).not.toContain('grove ai');
    expect(real).toContain('seo driver');
  });

  it('says there is no topic demand yet when every query was the brand', () => {
    const onlyBrand = { ...report, search_console: { ...report.search_console!, topQueries: report.search_console!.topQueries.slice(0, 3) } };
    expect(digestReport(onlyBrand, BRANDS)).toContain('every query this site appeared for was its own name');
  });

  it('changes nothing when no brand is given', () => {
    expect(digestReport(report)).not.toContain('BRAND SEARCHES');
  });
});
