import { describe, it, expect } from 'vitest';
import { computeScores } from '../lib/pipeline/manager';

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

  it('missing/garbled scores default to a neutral 70, never 0', () => {
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
