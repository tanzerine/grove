import { describe, it, expect } from 'vitest';
import { normalizeIcp, icpSeeds, icpIsUsable, formatIcpForPrompt, type CustomerProfile } from '../lib/strategy/icp';

const icp = (over: Partial<CustomerProfile> = {}): CustomerProfile => ({
  segments: [], jobs: [], pains: [], triggers: [], vocabulary: [], objections: [], ...over,
});

describe('normalizeIcp', () => {
  it('degrades a broken payload to an empty profile, never to undefined fields', () => {
    // seed derivation runs three steps later; undefined here would throw there.
    for (const bad of [null, undefined, 'nope', 42, []]) {
      const out = normalizeIcp(bad as unknown);
      expect(out.vocabulary).toEqual([]);
      expect(out.segments).toEqual([]);
      expect(out.pains).toEqual([]);
    }
  });

  it('keeps well-formed fields and drops junk entries', () => {
    const out = normalizeIcp({
      segments: [{ name: 'solo founder', situation: 'ships at midnight' }, { name: '', situation: 'x' }],
      vocabulary: ['write blog posts faster', '', 42, '  trimmed  '],
      pains: ['no time to write'],
    });
    expect(out.segments).toEqual([{ name: 'solo founder', situation: 'ships at midnight' }]);
    expect(out.vocabulary).toEqual(['write blog posts faster', 'trimmed']);
    expect(out.pains).toEqual(['no time to write']);
  });

  it('caps every list so one runaway field cannot dominate the seed order', () => {
    const out = normalizeIcp({
      segments: Array.from({ length: 20 }, (_, i) => ({ name: `s${i}`, situation: 'x' })),
      vocabulary: Array.from({ length: 99 }, (_, i) => `v${i}`),
    });
    expect(out.segments).toHaveLength(4);
    expect(out.vocabulary).toHaveLength(20);
  });
});

describe('icpIsUsable', () => {
  it('needs enough signal to research from', () => {
    expect(icpIsUsable(null)).toBe(false);
    expect(icpIsUsable(icp())).toBe(false);
    expect(icpIsUsable(icp({ vocabulary: ['a', 'b'] }))).toBe(false);
    expect(icpIsUsable(icp({ vocabulary: ['a', 'b'], pains: ['c'] }))).toBe(true);
  });
});

describe('icpSeeds', () => {
  it('puts customer vocabulary ahead of pains and jobs', () => {
    // Ordering decides what survives the caller's limit, so it is the design.
    const out = icpSeeds(icp({
      vocabulary: ['blog automation'],
      pains: ['writing takes too long'],
      jobs: ['publish consistently'],
    }), { limit: 3 });
    expect(out[0]).toBe('blog automation');
  });

  it('narrows sentences into the noun phrase inside them', () => {
    const out = icpSeeds(icp({ pains: ['I have no time to write blog posts every week'] }));
    expect(out.length).toBeGreaterThan(0);
    // seedCandidates caps seed length; nothing should come back as the sentence
    expect(out.every((s) => s.split(/\s+/).length <= 4)).toBe(true);
  });

  it('drops the brand name — a business name is not demand', () => {
    const out = icpSeeds(icp({ vocabulary: ['Grove', 'blog automation'] }), { brand: 'Grove' });
    expect(out).not.toContain('Grove');
    expect(out).toContain('blog automation');
  });

  it('dedupes case-insensitively across fields', () => {
    const out = icpSeeds(icp({ vocabulary: ['Blog Automation'], pains: ['blog automation'] }));
    expect(out.filter((s) => s.toLowerCase() === 'blog automation')).toHaveLength(1);
  });

  it('honours the limit and returns [] for an empty profile', () => {
    expect(icpSeeds(icp({ vocabulary: ['a b', 'c d', 'e f'] }), { limit: 2 })).toHaveLength(2);
    expect(icpSeeds(null)).toEqual([]);
    expect(icpSeeds(icp())).toEqual([]);
  });

  it('carries Korean vocabulary through', () => {
    const out = icpSeeds(icp({ vocabulary: ['블로그 자동화'] }));
    expect(out).toContain('블로그 자동화');
  });
});

describe('formatIcpForPrompt', () => {
  it('says plainly when nothing was inferred, rather than emitting an empty block', () => {
    expect(formatIcpForPrompt(null)).toContain('not inferred');
    expect(formatIcpForPrompt(icp())).toContain('not inferred');
  });

  it('renders segments, pains and the customer register', () => {
    const out = formatIcpForPrompt(icp({
      segments: [{ name: 'solo founder', situation: 'ships at midnight' }],
      pains: ['no time to write'],
      triggers: ['traffic flatlined'],
      objections: ['worried AI writes nonsense'],
      vocabulary: ['blog automation', 'write faster'],
    }));
    expect(out).toContain('solo founder — ships at midnight');
    expect(out).toContain('pains: no time to write');
    expect(out).toContain('starts looking when: traffic flatlined');
    expect(out).toContain('hesitates because: worried AI writes nonsense');
    expect(out).toContain('their words: blog automation, write faster');
  });
});
