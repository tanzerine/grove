import { describe, it, expect } from 'vitest';
import { summarizeReadiness, plainNote } from '../lib/readiness';

const FULL = { word_count: 1200, faq_count: 3, key_takeaways_count: 4, citation_count: 3, serp_gap_count: 0 };

describe('summarizeReadiness', () => {
  it('is ready when the hard checks pass', () => {
    const r = summarizeReadiness({ stats: FULL, issues: [], managerOverall: 82 });
    expect(r.status).toBe('ready');
    expect(r.headline).toBe('Ready to bring you visitors');
    expect(r.checks.every((c) => c.ok)).toBe(true);
    expect(r.notes).toEqual([]);
  });

  it('drops to almost when a hard check fails', () => {
    const r = summarizeReadiness({ stats: { ...FULL, citation_count: 0 }, issues: ['LOW_CITATIONS: 0 markdown links'] });
    expect(r.status).toBe('almost');
    expect(r.checks.find((c) => c.label === 'Backed by real sources')!.ok).toBe(false);
    expect(r.notes).toContain('Add a source or two for credibility');
  });

  it('is a draft when every hard check fails', () => {
    const r = summarizeReadiness({ stats: { word_count: 200, faq_count: 0, key_takeaways_count: 0, citation_count: 0 } });
    expect(r.status).toBe('draft');
    expect(r.headline).toBe('Still a rough draft');
  });

  it('counts a SERP gap as not covering search demand', () => {
    const r = summarizeReadiness({ stats: { ...FULL, serp_gap_count: 2 } });
    expect(r.checks.find((c) => c.label === 'Covers what people are searching')!.ok).toBe(false);
  });

  it('treats voice as soft (low manager score does not block ready)', () => {
    const ready = summarizeReadiness({ stats: FULL, managerOverall: 50 });
    expect(ready.status).toBe('ready');
    expect(ready.checks.find((c) => c.label === 'Sounds like you')!.ok).toBe(false);
  });

  it('de-jargons and caps notes at three, deduped', () => {
    const r = summarizeReadiness({
      stats: { word_count: 200 },
      issues: ['MISSING_FAQ: 1', 'MISSING_KEY_TAKEAWAYS: 0', 'THIN_CONTENT: 200', 'LOW_CITATIONS: 1', 'EM_DASH_OVERUSE: 5'],
    });
    expect(r.notes).toHaveLength(3);
    expect(r.notes).not.toContain('EM_DASH_OVERUSE: 5'); // nitpick hidden
  });
});

describe('plainNote', () => {
  it('pulls the quoted subtopics out of a SERP gap', () => {
    expect(plainNote('SERP_GAP: top-ranking pages cover "water temperature", "paper filter" — your draft doesn\'t'))
      .toBe('Top results also cover "water temperature", "paper filter" — worth adding');
  });

  it('maps known flags and hides nitpicks', () => {
    expect(plainNote('MISSING_FAQ: 1 Q&A')).toBe('Add a short FAQ — it helps AI answers quote you');
    expect(plainNote('BANNED_PHRASE: \'game-changer\'')).toBeNull();
  });
});
