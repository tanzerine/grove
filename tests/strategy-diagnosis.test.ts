import { describe, it, expect } from 'vitest';
import {
  diagnose, followUp, formatDiagnosisForPrompt, metrics, searchHealth, storedDiagnosis,
  type DiagnosisSignals,
} from '../lib/strategy/diagnosis';
import { needsWidening, widenSeeds } from '../lib/strategy/widen';
import type { Bet, BetVerdict } from '../lib/strategy/bets';

/**
 * The diagnosis is the step the loop was missing between measuring and
 * planning. Its order is the behaviour: the first finding that fires is what
 * the plan must answer. Fixtures follow trygroveai.com on 2026-10-05: 18 days
 * since the last article, 18 drafts in review, 16 non-brand articles judged,
 * none in the top 20.
 */

const bet = (verdict: BetVerdict, i = 0): Bet => ({
  postId: `p${i}`, title: `Post ${i}`, targetKeyword: `kw ${i}`, ageDays: 40, verdict,
  target: null, pageImpressions: 0, shownFor: null,
});
const bets = (spec: Partial<Record<BetVerdict, number>>): Bet[] =>
  Object.entries(spec).flatMap(([v, n], j) => Array.from({ length: n! }, (_, i) => bet(v as BetVerdict, j * 100 + i)));

const grove: DiagnosisSignals = {
  pipeline: { publishedLast30: 6, daysSinceLastPublish: 18, inReview: 18, oldestReviewDays: 71 },
  search: { queryImpressions: 250, brandImpressions: 236, nonBrandQueries: 5, bestNonBrandPosition: 22 },
  bets: bets({ unseen: 8, elsewhere: 6, far: 2, brand: 7, too_early: 7 }),
  pool: { winnableClusters: 1, slots: 12, widened: true },
};

describe('diagnose', () => {
  it('puts a stalled pipeline first, and keeps every other finding', () => {
    const d = diagnose(grove);
    expect(d.primary.kind).toBe('not_shipping');
    expect(d.primary.evidence).toContain('18 drafts waiting in review, the oldest 71 days');
    expect(d.primary.answer).toContain('18 finished drafts are waiting for the owner');
    expect(d.others.map((f) => f.kind)).toEqual(['brand_only', 'not_shown', 'out_of_reach', 'thin_demand']);
  });

  it('reads search reach once the pipeline is moving', () => {
    const d = diagnose({ ...grove, pipeline: { publishedLast30: 12, daysSinceLastPublish: 2, inReview: 1, oldestReviewDays: 3 } });
    expect(d.primary.kind).toBe('brand_only');
    expect(d.primary.evidence).toContain('94% of search impressions');
  });

  it('judges reach and difficulty on non-brand articles only', () => {
    const m = metrics(grove);
    expect(m.unseen_share_pct).toBe(50);   // 8 of 16 — brand and too-new bets excluded
    expect(m.top20_bets).toBe(0);
  });

  it('does not call a quiet new site stalled, or a small sample a failure', () => {
    const d = diagnose({
      pipeline: { publishedLast30: 0, daysSinceLastPublish: null, inReview: 0, oldestReviewDays: null },
      search: null,
      bets: bets({ unseen: 3 }),
      pool: null,
    });
    expect(d.primary.kind).toBe('too_early');
    expect(d.others).toEqual([]);
  });

  it('says what is working when something is', () => {
    const d = diagnose({ pipeline: null, search: null, bets: bets({ won: 1, close: 2, far: 3 }), pool: null });
    expect(d.primary.kind).toBe('working');
    expect(d.primary.evidence).toBe('3 of 6 judged targets reached the top 20');
  });

  it('flags thin demand against the slot count', () => {
    const d = diagnose({ pipeline: null, search: null, bets: [], pool: { winnableClusters: 2, slots: 8, widened: false } });
    expect(d.primary.kind).toBe('thin_demand');
  });
});

describe('followUp', () => {
  const stored = storedDiagnosis(diagnose(grove));   // not_shipping, published_last_30 = 6

  it('says the previous answer did not work when its metric did not move', () => {
    const fu = followUp(stored, diagnose(grove), grove)!;
    expect(fu.verdict).toBe('unchanged');
    expect(formatDiagnosisForPrompt(diagnose(grove), fu)).toContain('Last month\'s plan did not move it. Do not repeat that approach');
  });

  it('knows which direction is better for each metric', () => {
    const fewer = { ...grove, pipeline: { ...grove.pipeline!, publishedLast30: 2 } };
    expect(followUp(stored, diagnose(fewer), fewer)!.verdict).toBe('worse');

    const brandStored = { kind: 'brand_only' as const, headline: 'x', metric: { name: 'brand_share_pct' as const, value: 94 } };
    const lessBrand = { ...grove, search: { ...grove.search!, brandImpressions: 220 } };   // 88%, still fires
    expect(followUp(brandStored, diagnose(lessBrand), lessBrand)!.verdict).toBe('improved');
  });

  it('calls it resolved once the finding no longer fires', () => {
    const shipping = { ...grove, pipeline: { publishedLast30: 14, daysSinceLastPublish: 1, inReview: 0, oldestReviewDays: null } };
    expect(followUp(stored, diagnose(shipping), shipping)!.verdict).toBe('resolved');
  });

  it('is absent with no previous diagnosis', () => {
    expect(followUp(null, diagnose(grove), grove)).toBeNull();
  });
});

describe('formatDiagnosisForPrompt', () => {
  it('names the primary, what the plan must do, and asks notes to answer it', () => {
    const out = formatDiagnosisForPrompt(diagnose(grove), null);
    expect(out).toMatch(/^DIAGNOSIS — /);
    expect(out).toContain('PRIMARY: Articles are not reaching readers');
    expect(out).toContain('THIS PLAN MUST ANSWER IT:');
    expect(out).toContain('ALSO TRUE');
    expect(out).toContain('In "notes", begin with the diagnosis');
  });
});

describe('searchHealth', () => {
  it('splits impressions by brand and finds the best non-brand position', () => {
    const h = searchHealth({
      impressions: 477, clicks: 17, ctr: 0.04, avgPosition: 9, queryCount: 4, nearWinners: [],
      topQueries: [
        { query: 'grove ai', impressions: 207, clicks: 2, position: 7.4 },
        { query: 'groce ai', impressions: 14, clicks: 0, position: 5.6 },
        { query: 'solid seo in only 2 hours per week', impressions: 1, clicks: 0, position: 22 },
        { query: 'seo driver', impressions: 1, clicks: 0, position: 74 },
      ],
    }, ['Grove', 'trygroveai'])!;
    expect(h).toEqual({ queryImpressions: 223, brandImpressions: 221, nonBrandQueries: 2, bestNonBrandPosition: 22 });
    expect(searchHealth(null, ['Grove'])).toBeNull();
  });
});

describe('widening', () => {
  it('widens only when fewer winnable clusters than slots', () => {
    expect(needsWidening(1, 12)).toBe(true);
    expect(needsWidening(12, 12)).toBe(false);
    expect(needsWidening(0, 0)).toBe(false);
  });

  it('takes new seeds in order, skipping researched ones and the brand', () => {
    expect(widenSeeds(
      ['Koala AI alternative', 'seo for founders', 'grove ai pricing', 'koala ai alternative', 'add blog to nextjs', 'byword alternative'],
      ['SEO for founders'],
      ['Grove', 'trygroveai'],
      2,
    )).toEqual(['Koala AI alternative', 'add blog to nextjs']);
  });
});
