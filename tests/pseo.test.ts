import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the two external dependencies (LLM + autocomplete) but keep the real
// classifyIntent so intent labelling is exercised end-to-end.
vi.mock('../lib/llm', async (orig) => {
  const actual = await orig<typeof import('../lib/llm')>();
  return { ...actual, llmCall: vi.fn() };
});
vi.mock('../lib/strategy/keywords', async (orig) => {
  const actual = await orig<typeof import('../lib/strategy/keywords')>();
  return { ...actual, gatherKeywordDemand: vi.fn() };
});

import { planProgrammaticSet, generateProgrammaticPage } from '../lib/pseo';
import { llmCall } from '../lib/llm';
import { gatherKeywordDemand } from '../lib/strategy/keywords';

const profile = {
  business: {
    name: 'Acme', industry: 'coffee', description: 'fresh beans',
    target_audience: 'home brewers', products_services: ['cold brew kit'], value_props: ['fresh'],
  },
} as any;

const demand = [
  { keyword: 'cold brew ratio', intent: 'informational' as const, score: 9 },
  { keyword: 'best cold brew maker', intent: 'commercial' as const, score: 7 },
  { keyword: 'unrelated thing', intent: 'informational' as const, score: 6 },
];

beforeEach(() => vi.clearAllMocks());

describe('planProgrammaticSet', () => {
  it('uses LLM titles and classifies intent, seed-matching phrases first', async () => {
    (gatherKeywordDemand as any).mockResolvedValue(demand);
    (llmCall as any).mockResolvedValue({
      text: JSON.stringify({ titles: [
        { keyword: 'cold brew ratio', title: 'The Right Cold Brew Ratio' },
        { keyword: 'best cold brew maker', title: 'Picking a Cold Brew Maker' },
      ] }),
    });

    const plan = await planProgrammaticSet(profile, 'cold brew', 2);
    expect(plan.pages.length).toBe(2);
    // phrases containing the seed are prioritized → "unrelated thing" excluded at count=2
    expect(plan.pages.map((p) => p.keyword)).toEqual(['cold brew ratio', 'best cold brew maker']);
    expect(plan.pages[0].title).toBe('The Right Cold Brew Ratio');
    expect(plan.pages[1].intent).toBe('commercial');
  });

  it('falls back to templated titles when the titling model fails', async () => {
    (gatherKeywordDemand as any).mockResolvedValue(demand);
    (llmCall as any).mockRejectedValue(new Error('model down'));

    const plan = await planProgrammaticSet(profile, 'cold brew', 1);
    expect(plan.pages[0].title).toBe('Cold Brew Ratio'); // titleCase of the keyword
  });

  it('still returns a seed-only page when no demand is found', async () => {
    (gatherKeywordDemand as any).mockResolvedValue([]);
    (llmCall as any).mockResolvedValue({ text: '[]' });

    const plan = await planProgrammaticSet(profile, 'niche topic', 5);
    expect(plan.pages.length).toBe(1);
    expect(plan.pages[0].keyword).toBe('niche topic');
  });
});

describe('generateProgrammaticPage', () => {
  const spec = { keyword: 'cold brew ratio', title: 'The Right Cold Brew Ratio', intent: 'informational' as const };

  it('returns content and clamps meta lengths', async () => {
    (llmCall as any).mockResolvedValue({
      text: JSON.stringify({
        meta_title: 'x'.repeat(90),
        meta_description: 'y'.repeat(200),
        body_md: 'A solid, useful answer. '.repeat(20),
      }),
    });
    const out = await generateProgrammaticPage(profile, spec);
    expect(out.meta_title.length).toBeLessThanOrEqual(70);
    expect(out.meta_description.length).toBeLessThanOrEqual(160);
    expect(out.body_md.length).toBeGreaterThan(200);
  });

  it('throws on a too-short body so an empty page never persists', async () => {
    (llmCall as any).mockResolvedValue({
      text: JSON.stringify({ meta_title: 't', meta_description: 'd', body_md: 'too short' }),
    });
    await expect(generateProgrammaticPage(profile, spec)).rejects.toThrow(/too short/);
  });
});
