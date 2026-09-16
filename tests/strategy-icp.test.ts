import { describe, it, expect } from 'vitest';
import { normalizeIcp, icpSeeds, buyerIntentSeeds, icpIsUsable, formatIcpForPrompt, type CustomerProfile } from '../lib/strategy/icp';

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

/**
 * The inference itself. Mocked at the model boundary: what matters here is
 * that a failure degrades to EMPTY and SAYS SO — the first production build
 * with this step took the silent fallback and planned from the industry label.
 */
vi.mock('../lib/llm', () => ({
  llmCall: vi.fn(),
  extractJson: (text: string) => JSON.parse(text),
}));
import { vi, afterEach } from 'vitest';
import { llmCall } from '../lib/llm';
import { buildCustomerProfile } from '../lib/strategy/icp';

const BIZ = { business: {
  name: 'Grove', industry: 'AI Marketing Software / B2B SaaS', description: 'x',
  products_services: ['Autonomous AI blog writing'], target_audience: 'founders', value_props: [], geography: 'global',
} } as any;

describe('buildCustomerProfile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks the workhorse model, not the fast one, and normalizes what comes back', async () => {
    vi.mocked(llmCall).mockResolvedValueOnce({
      text: JSON.stringify({ segments: [{ name: 'solo founder', situation: 'no marketing hire' }], jobs: ['get traffic'], pains: ['blog is empty'], vocabulary: ['automate blog posts'], triggers: [], objections: [] }),
      usage: {} as any,
    });
    const icp = await buildCustomerProfile(BIZ, 'en');
    expect(icp.segments[0].name).toBe('solo founder');
    expect(icp.vocabulary).toEqual(['automate blog posts']);
    // Language command first in the USER prompt, and a real ceiling — not the
    // fast helper's fixed 30s.
    const call = vi.mocked(llmCall).mock.calls[0][0];
    expect(call.timeoutMs).toBeGreaterThanOrEqual(60_000);
    expect(call.user.indexOf('Grove')).toBeGreaterThan(0);
  });

  it('degrades a failed call to an empty profile and warns, rather than failing the month', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(llmCall).mockRejectedValueOnce(new Error('Replicate prediction failed: boom'));
    const icp = await buildCustomerProfile(BIZ, 'en');
    expect(icp.vocabulary).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/inference failed for Grove.*boom/);
  });

  it('warns when the profile is too thin to research from', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(llmCall).mockResolvedValueOnce({ text: JSON.stringify({ vocabulary: ['one'] }), usage: {} as any });
    const icp = await buildCustomerProfile(BIZ, 'en');
    expect(icp.vocabulary).toEqual(['one']);
    expect(String(warn.mock.calls[0][0])).toMatch(/too thin/);
  });
});

describe('the buyer half of the profile', () => {
  it('normalizes competitors, workarounds and use cases, capped, and never undefined', () => {
    const out = normalizeIcp({
      vocabulary: ['a'],
      competitors: ['Iconikai', ' icons8 3d ', 42, ''],
      workarounds: Array.from({ length: 12 }, (_, i) => `w${i}`),
    });
    expect(out.competitors).toEqual(['Iconikai', 'icons8 3d']);
    expect(out.workarounds).toHaveLength(6);
    expect(out.use_cases).toEqual([]);
    // A profile stored before these fields existed parses to empty lists too.
    expect(normalizeIcp({ vocabulary: ['a'] }).competitors).toEqual([]);
  });

  it('turns each competitor into the two queries a buyer types about it', () => {
    const out = buyerIntentSeeds(icp({ competitors: ['Iconikai'] }), { lang: 'en' });
    expect(out).toEqual(['iconikai alternative', 'iconikai vs']);
    expect(buyerIntentSeeds(icp({ competitors: ['Iconikai'] }), { lang: 'ko' })).toEqual(['iconikai 대안', 'iconikai 비교']);
  });

  it('Search Console names come first and merge with the model\'s by name', () => {
    const out = buyerIntentSeeds(
      icp({ competitors: ['icons8 3d', 'Iconikai'] }),
      { lang: 'en', knownCompetitors: ['iconikai', 'applaunchflow icon composer'] },
    );
    expect(out.slice(0, 6)).toEqual([
      'iconikai alternative', 'iconikai vs',
      'applaunchflow icon composer alternative', 'applaunchflow icon composer vs',
      'icons8 3d alternative', 'icons8 3d vs',
    ]);
    expect(out.filter((s) => s.startsWith('iconikai'))).toHaveLength(2);   // not four
  });

  it('passes workarounds and use cases through whole — "for" is part of the query here', () => {
    const out = buyerIntentSeeds(icp({
      workarounds: ['3d icon in illustrator'],
      use_cases: ['3d icons for saas landing page'],
    }), { lang: 'en' });
    expect(out).toEqual(['3d icon in illustrator', '3d icons for saas landing page']);
  });

  it('never seeds from the business\'s own name, and bounds the total', () => {
    const out = buyerIntentSeeds(icp({
      competitors: ['Oven AI', 'iconikai', 'b', 'c', 'd', 'e'],
      workarounds: ['w1', 'w2', 'w3'],
      use_cases: ['u1 u2', 'u3 u4'],
    }), { lang: 'en', brand: 'Oven AI', limit: 9 });
    expect(out.some((s) => s.includes('oven ai'))).toBe(false);
    expect(out).toHaveLength(9);
    // Competitors are capped at four names, so the model cannot spend the
    // whole budget on a list it may have invented.
    expect(out.filter((s) => / (alternative|vs)$/.test(s))).toHaveLength(8);
  });

  it('is empty without a profile', () => {
    expect(buyerIntentSeeds(null, { lang: 'en' })).toEqual([]);
    expect(buyerIntentSeeds(icp(), { lang: 'en' })).toEqual([]);
  });

  it('the planner prompt names who they compare against', () => {
    const text = formatIcpForPrompt(icp({ vocabulary: ['a', 'b'], pains: ['c'], competitors: ['iconikai'], use_cases: ['3d app icon ios'] }));
    expect(text).toContain('compares against: iconikai');
    expect(text).toContain('needs it for: 3d app icon ios');
  });
});
