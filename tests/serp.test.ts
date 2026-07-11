import { describe, it, expect } from 'vitest';
import { extractSerpCoverage, coverageGap } from '../lib/pipeline/serp';

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

describe('coverageGap', () => {
  const body = 'We tested grind size with a burr grinder. Water temperature stayed near 93C.';

  it('returns subtopics the draft does not address', () => {
    const gap = coverageGap(['burr grinder', 'water temperature', 'paper filter', 'bloom phase'], body);
    expect(gap).toEqual(['paper filter', 'bloom phase']);
  });

  it('counts a multi-word subtopic as covered when all its words appear', () => {
    // "grind size" both present though not adjacent in this phrasing
    expect(coverageGap(['grind size'], 'The size of your grind is everything.')).toEqual([]);
  });

  it('is empty when there are no subtopics or no body', () => {
    expect(coverageGap([], body)).toEqual([]);
    expect(coverageGap(['anything'], '')).toEqual([]);
  });

  it('respects the max', () => {
    const subs = ['a-aa', 'b-bb', 'c-cc', 'd-dd', 'e-ee', 'f-ff', 'g-gg'];
    expect(coverageGap(subs, 'none of them here', 3)).toHaveLength(3);
  });
});

describe('stopword filtering', () => {
  it('never surfaces function words as consensus subtopics', () => {
    const filler =
      'How to turn your flat design into a 3d logo. Not all apps can turn designs into icons. ' +
      'Turn it into something. Not all of them. All into turn not.';
    const pages = [1, 2, 3].map(() => ({ title: 'p', content: filler.repeat(3) }));
    const { subtopics } = extractSerpCoverage(pages, '3d logo');
    for (const bad of ['into', 'turn', 'not', 'all']) {
      expect(subtopics).not.toContain(bad);
      expect(subtopics.some((s) => s.split(' ').includes(bad))).toBe(false);
    }
  });
});
