import { describe, it, expect } from 'vitest';
import { extractSerpCoverage } from '../lib/pipeline/serp';

describe('extractSerpCoverage', () => {
  const pages = [
    { title: 'Pour over guide', content: '## Grind size\nGrind size matters. Burr grinder beats blade grinder.\n## Water temperature\nWater temperature around 93C. Paper filter traps oils.' },
    { title: 'Better pour over', content: 'A burr grinder gives even grind size. Water temperature is critical. Bloom the coffee first.' },
    { title: 'Coffee basics', content: 'Use a burr grinder. Control water temperature. The paper filter changes the taste.' },
  ];

  it('surfaces consensus subtopics that appear across multiple pages', () => {
    const cov = extractSerpCoverage(pages, 'pour over coffee');
    // "burr grinder", "water temperature", "grind size", "paper filter" recur across pages
    expect(cov.subtopics).toContain('burr grinder');
    expect(cov.subtopics).toContain('water temperature');
    expect(cov.subtopics.some((s) => s.includes('grind'))).toBe(true);
  });

  it('drops the keyword tokens, stopwords, and web filler', () => {
    const cov = extractSerpCoverage(pages, 'pour over coffee');
    for (const junk of ['coffee', 'pour', 'guide', 'the', 'use', 'first']) {
      expect(cov.subtopics).not.toContain(junk);
    }
  });

  it('collapses a unigram that is contained in a chosen bigram', () => {
    const cov = extractSerpCoverage(pages, 'pour over coffee');
    if (cov.subtopics.includes('burr grinder')) {
      expect(cov.subtopics).not.toContain('burr');
      expect(cov.subtopics).not.toContain('grinder');
    }
  });

  it('detects markdown section headings', () => {
    const cov = extractSerpCoverage(pages, 'pour over coffee');
    expect(cov.headings).toContain('Grind size');
    expect(cov.headings).toContain('Water temperature');
  });

  it('returns empty arrays for empty input', () => {
    expect(extractSerpCoverage([], 'x')).toEqual({ subtopics: [], headings: [] });
    expect(extractSerpCoverage([{ content: '' }], 'x')).toEqual({ subtopics: [], headings: [] });
  });

  it('respects the limit', () => {
    const cov = extractSerpCoverage(pages, 'pour over coffee', 2);
    expect(cov.subtopics.length).toBeLessThanOrEqual(2);
  });
});
