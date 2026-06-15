import { describe, it, expect } from 'vitest';
import { scoreAeo } from '../lib/aeo-score';

describe('scoreAeo', () => {
  it('scores a fully answer-engine-ready article 100 / strong', () => {
    const r = scoreAeo({ key_takeaways_count: 4, faq_count: 3, citation_count: 3, word_count: 1200 });
    expect(r.score).toBe(100);
    expect(r.grade).toBe('strong');
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it('scores an empty/missing stats object 0 / weak', () => {
    for (const stats of [null, undefined, {}]) {
      const r = scoreAeo(stats as any);
      expect(r.score).toBe(0);
      expect(r.grade).toBe('weak');
      expect(r.checks.every((c) => !c.ok)).toBe(true);
    }
  });

  it('grades partial readiness (2/4 → 50 → fair)', () => {
    const r = scoreAeo({ key_takeaways_count: 3, faq_count: 2, citation_count: 0, word_count: 400 });
    expect(r.score).toBe(50);
    expect(r.grade).toBe('fair');
    const byLabel = Object.fromEntries(r.checks.map((c) => [c.label, c.ok]));
    expect(byLabel['Key takeaways']).toBe(true);
    expect(byLabel['FAQ section']).toBe(true);
    expect(byLabel['Cited evidence']).toBe(false);
    expect(byLabel['In-depth']).toBe(false);
  });

  it('applies each threshold at its boundary', () => {
    // one below every threshold → all fail
    const low = scoreAeo({ key_takeaways_count: 2, faq_count: 1, citation_count: 1, word_count: 899 });
    expect(low.checks.every((c) => !c.ok)).toBe(true);
    // exactly at every threshold → all pass
    const at = scoreAeo({ key_takeaways_count: 3, faq_count: 2, citation_count: 2, word_count: 900 });
    expect(at.checks.every((c) => c.ok)).toBe(true);
  });
});
