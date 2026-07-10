import { describe, it, expect } from 'vitest';
import { genreFor, authorFor } from '../lib/blog-genre';

describe('genreFor', () => {
  it('maps every pipeline format to a display genre', () => {
    expect(genreFor('guide', null).label).toBe('Guide');
    expect(genreFor('experiment', null).label).toBe('Case study');
    expect(genreFor('opinion', null).label).toBe('Opinion');
    expect(genreFor('launch', null).label).toBe('News');
    expect(genreFor('curation', null).label).toBe('Roundup');
    expect(genreFor('roadmap', null).label).toBe('Roadmap');
    expect(genreFor('behind-the-scenes', null).label).toBe('Inside look');
    expect(genreFor('list', null).label).toBe('Listicle');
    expect(genreFor('tutorial', null).label).toBe('Tutorial');
    expect(genreFor('deep-dive', null).label).toBe('Deep dive');
  });

  it('falls back to title heuristics for legacy posts without a format', () => {
    expect(genreFor(null, 'How to brew filter coffee').id).toBe('guide');
    expect(genreFor(null, '7 ways to store beans').id).toBe('listicle');
    expect(genreFor(null, 'Aeropress vs French press compared').id).toBe('comparison');
    expect(genreFor(null, 'Why dark roast is overrated').id).toBe('opinion');
    expect(genreFor(null, 'A deep dive into style memory').id).toBe('deep-dive');
  });

  it('handles Korean title patterns', () => {
    expect(genreFor(null, '원두 보관하는 법').id).toBe('guide');
    expect(genreFor(null, '핸드드립 도구 5가지').id).toBe('listicle');
  });

  it('defaults to Article, never an "AI" label', () => {
    const g = genreFor(null, 'Some unclassifiable musings');
    expect(g.label).toBe('Article');
    expect(g.label.toLowerCase()).not.toContain('ai');
    expect(genreFor('unknown-format', null).label).toBe('Article');
  });
});

describe('authorFor', () => {
  it('uses the founder name when the profile has one', () => {
    expect(authorFor({ business: { name: 'Oveners', founder: 'Taeyun Lee' } }, 'oveners.com')).toBe('Taeyun Lee');
  });
  it('falls back to "{Business} Team"', () => {
    expect(authorFor({ business: { name: 'Oveners' } }, 'oveners.com')).toBe('Oveners Team');
  });
  it('falls back to the hostname when there is no profile at all', () => {
    expect(authorFor(null, 'www.oveners.com')).toBe('oveners.com Team');
  });
});
