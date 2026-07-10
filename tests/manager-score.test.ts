import { describe, it, expect } from 'vitest';
import { computeScores, missingAxes, holdForReview, AUTO_PUBLISH_FLOOR, QUALITY_FLOOR, type Evaluation } from '../lib/pipeline/manager';

const evalWith = (over: Partial<Evaluation> & { overall?: number }): Evaluation => ({
  action: 'approve',
  pass: true,
  scores: { strategic_fit: 70, marketing: 70, craft: 70, safety: 70, overall: over.overall ?? 72 },
  issues: [],
  ...over,
});

describe('computeScores', () => {
  it('a competent draft lands in the 70-85 band (with strategy)', () => {
    const s = computeScores({ strategic_fit: 80, marketing: 75, craft: 80, safety: 75 }, true);
    expect(s.overall).toBeGreaterThanOrEqual(70);
    expect(s.overall).toBeLessThanOrEqual(85);
  });

  it('no active strategy does NOT tank the score (strategic_fit dropped from weighting)', () => {
    // model omits strategic_fit; craft/marketing are solid
    const s = computeScores({ marketing: 75, craft: 80, safety: 75 }, false);
    expect(s.overall).toBeGreaterThanOrEqual(70);
  });

  it('missing/garbled scores fill with a neutral 70, never 0 (flagged separately)', () => {
    const s = computeScores({}, true);
    expect(s.overall).toBe(70);
    expect(s.craft).toBe(70);
  });

  it('a genuinely weak draft still scores low', () => {
    const s = computeScores({ strategic_fit: 20, marketing: 30, craft: 25, safety: 40 }, true);
    expect(s.overall).toBeLessThan(40);
  });

  it('clamps out-of-range values', () => {
    const s = computeScores({ strategic_fit: 999, marketing: -5, craft: 80, safety: 75 }, true);
    expect(s.strategic_fit).toBe(100);
    expect(s.marketing).toBe(0);
  });
});

describe('missingAxes', () => {
  it('names every axis the model failed to score', () => {
    expect(missingAxes({ craft: 80, safety: 'high' }, true))
      .toEqual(['strategic_fit', 'marketing', 'safety']);
  });

  it('is empty for a complete score set', () => {
    expect(missingAxes({ strategic_fit: 80, marketing: 75, craft: 80, safety: 75 }, true)).toEqual([]);
  });

  it('exempts strategic_fit when there is no active strategy (weight is zero)', () => {
    expect(missingAxes({ marketing: 75, craft: 80, safety: 75 }, false)).toEqual([]);
  });

  it('a fully empty response is flagged on every weighted axis', () => {
    expect(missingAxes({}, false)).toEqual(['marketing', 'craft', 'safety']);
  });
});

describe('holdForReview (autopilot publish gate)', () => {
  it('auto-publishes a solid approved draft', () => {
    expect(holdForReview(evalWith({ overall: 78 }), 0)).toBe(false);
  });

  it('auto-publishes a mediocre-but-not-fatal draft (above the low floor)', () => {
    // 55 would have been held by the old 70 bar; autopilot now ships it.
    expect(holdForReview(evalWith({ overall: 55 }), 0)).toBe(false);
  });

  it('does NOT hold on a rewrite verdict (publishable with notes)', () => {
    expect(holdForReview(evalWith({ action: 'rewrite', overall: 60 }), 0)).toBe(false);
  });

  it('does NOT hold on rewrite-severity issues', () => {
    const e = evalWith({ overall: 60, issues: [{ rule: 'craft', severity: 'rewrite', note: 'x' }] });
    expect(holdForReview(e, 0)).toBe(false);
  });

  it('holds when the manager rejected it (off-strategy)', () => {
    expect(holdForReview(evalWith({ action: 'reject', overall: 80 }), 0)).toBe(true);
  });

  it('holds on a block-severity issue even with a high score', () => {
    const e = evalWith({ overall: 90, issues: [{ rule: 'safety', severity: 'block', note: 'x' }] });
    expect(holdForReview(e, 0)).toBe(true);
  });

  it('holds when the score is way too poor', () => {
    expect(holdForReview(evalWith({ overall: AUTO_PUBLISH_FLOOR - 1 }), 0)).toBe(true);
  });

  it('holds when the deterministic validator has a blocking issue', () => {
    expect(holdForReview(evalWith({ overall: 85 }), 1)).toBe(true);
  });

  it('holds when the manager never produced an evaluation', () => {
    expect(holdForReview(null, 0)).toBe(true);
  });

  it('the autopilot floor sits well below the writer-target floor', () => {
    expect(AUTO_PUBLISH_FLOOR).toBeLessThan(QUALITY_FLOOR);
  });
});
