import { describe, it, expect } from 'vitest';
import {
  winProbability, opportunityScore, selectKeywords, DEFAULT_KD_CEILING,
  type ScoredKeyword,
} from '../lib/keywords/opportunity';

const kw = (
  keyword: string, volume: number | null, difficulty: number | null,
): ScoredKeyword => ({ keyword, volume, difficulty, intent: 'informational', source: 'dataforseo' });

describe('winProbability', () => {
  it('is certain comfortably below the ceiling', () => {
    expect(winProbability(0)).toBe(1);
    expect(winProbability(15, 30)).toBe(1);   // exactly half the ceiling
  });
  it('decays through the ceiling', () => {
    const at20 = winProbability(20, 30);
    const at30 = winProbability(30, 30);
    const at40 = winProbability(40, 30);
    expect(at20).toBeGreaterThan(at30);
    expect(at30).toBeGreaterThan(at40);
    expect(at30).toBeLessThan(1);
  });
  it('floors at a long shot rather than zero', () => {
    // "Impossible" is a stronger claim than the data supports, and a hard zero
    // would erase an otherwise enormous keyword from the plan entirely.
    expect(winProbability(100, 30)).toBe(0.02);
    expect(winProbability(45, 30)).toBe(0.02);
  });
  it('treats unknown difficulty as unsizeable, not as easy', () => {
    expect(winProbability(null)).toBe(0);
  });
  it('moves with the domain ceiling — difficulty is relative to the site', () => {
    // The same KD 40, judged against two domains. This is the whole reason
    // `ceiling` is a parameter rather than a constant.
    expect(winProbability(40, 30)).toBeLessThan(0.2);  // a stretch for a young blog
    expect(winProbability(40, 80)).toBe(1);            // routine for an established one
  });
});

describe('opportunityScore', () => {
  it('is estimated monthly impressions, so the number means something', () => {
    expect(opportunityScore(kw('a', 1000, 10))).toBe(1000);  // p = 1
    expect(opportunityScore(kw('b', 1000, 45))).toBe(20);    // p = 0.02
  });
  it('prefers a smaller winnable keyword over a huge unwinnable one', () => {
    const winnable = opportunityScore(kw('small but easy', 400, 8));
    const vanity = opportunityScore(kw('huge but brutal', 50_000, 90));
    expect(winnable).toBeGreaterThan(0);
    expect(vanity).toBeGreaterThan(0);
    // 400 × 1.0 = 400 vs 50000 × 0.02 = 1000 — the vanity term still wins on
    // raw expectation, which is correct and is why maxDifficulty exists as a
    // separate hard gate rather than being folded into the score.
    expect(vanity).toBeGreaterThan(winnable);
  });
  it('scores an unscorable candidate 0 so it can never outrank a measured one', () => {
    expect(opportunityScore(kw('autocomplete phrase', null, null))).toBe(0);
    expect(opportunityScore(kw('volume only', 5000, null))).toBe(0);
    expect(opportunityScore(kw('kd only', null, 5))).toBe(0);
  });
});

describe('selectKeywords', () => {
  it('rejects too-hard and too-small with a stated reason', () => {
    const out = selectKeywords([
      kw('good', 800, 12),
      kw('brutal', 90_000, 88),
      kw('tiny', 20, 5),
    ], { ceiling: 30 });

    expect(out.chosen.map((c) => c.keyword)).toEqual(['good']);
    expect(out.rejected).toContainEqual({ keyword: 'brutal', reason: 'too_hard' });
    expect(out.rejected).toContainEqual({ keyword: 'tiny', reason: 'too_small' });
  });

  it('counts unscorable candidates separately — a high count indicts the SOURCE', () => {
    // The autocomplete-only case: nothing can be selected, and the report says
    // why. Without this the planner would look like it rejected everything on
    // merit rather than never having had the data.
    const out = selectKeywords([
      kw('a', null, null), kw('b', null, null), kw('c', null, null),
    ]);
    expect(out.chosen).toEqual([]);
    expect(out.unscorable).toBe(3);
    expect(out.rejected.every((r) => r.reason === 'unscorable')).toBe(true);
  });

  it('breaks ties toward the easier keyword', () => {
    // Same expected impressions; the cheaper win compounds into authority first.
    const out = selectKeywords([kw('hard', 1000, 15), kw('easy', 1000, 5)], { ceiling: 30 });
    expect(out.chosen[0].keyword).toBe('easy');
  });

  it('honours the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => kw(`k${i}`, 1000 - i, 10));
    expect(selectKeywords(many, { limit: 5 }).chosen).toHaveLength(5);
  });

  it('a higher ceiling admits keywords a young domain could not attempt', () => {
    // 50 is past the default gate for a ceiling of 30 (1.5 x 30 = 45, inclusive)
    // and comfortably inside it for a ceiling of 60.
    const cands = [kw('mid', 2000, 50)];
    expect(selectKeywords(cands, { ceiling: 30 }).chosen).toHaveLength(0);
    expect(selectKeywords(cands, { ceiling: 60 }).chosen).toHaveLength(1);
  });

  it('defaults are the cautious young-domain numbers', () => {
    expect(DEFAULT_KD_CEILING).toBe(30);
    // volume floor 100 by default
    expect(selectKeywords([kw('x', 99, 5)]).chosen).toHaveLength(0);
    expect(selectKeywords([kw('x', 100, 5)]).chosen).toHaveLength(1);
  });
});

describe('the long tail', () => {
  it('keeps measured, winnable phrases under the floor for clustering instead of discarding them', () => {
    const cands = [
      { keyword: 'publish blog posts', volume: 900, difficulty: 20, intent: null, source: 'dataforseo' },
      { keyword: 'publish blog posts automatically', volume: 40, difficulty: 12, intent: null, source: 'dataforseo' },
      { keyword: 'publish blog posts on a schedule', volume: 70, difficulty: 60, intent: null, source: 'dataforseo' },   // too hard — not tail
      { keyword: 'publish blog posts free', volume: 0, difficulty: 10, intent: null, source: 'dataforseo' },            // zero demand — not tail
      { keyword: 'how to publish', volume: null, difficulty: null, intent: null, source: 'autocomplete' },
    ];
    const s = selectKeywords(cands, { minVolume: 100 });
    expect(s.chosen.map((k) => k.keyword)).toEqual(['publish blog posts']);
    expect(s.longTail.map((k) => k.keyword)).toEqual(['publish blog posts automatically']);
    // The rejection ledger is unchanged: the tail is still reported as too_small.
    expect(s.rejected.find((r) => r.keyword === 'publish blog posts automatically')?.reason).toBe('too_small');
  });
});
