/**
 * Fixtures are the REAL production profiles as of 2026-09-05, verbatim.
 * That matters: the bug was that plausible-looking marketing copy returns
 * nothing from Google Autocomplete, and a hand-written fixture would have been
 * written to pass. Each expectation below names a phrase that was measured
 * against the live endpoint — 0 suggestions for the raw string, 10 for the
 * head term the extractor now pulls out of it.
 */
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { searchSeeds, seedCandidates, isBrandTerm, narrowSeed, parseLocalizedSeeds, localizeSeeds, MAX_SEED_WORDS } from '@/lib/strategy/seeds';

vi.mock('@/lib/llm', () => ({ fastLlmCall: vi.fn() }));
import { fastLlmCall } from '@/lib/llm';

/** trygroveai.com — every one of these returned 0 autocomplete suggestions. */
const GROVE = {
  business: {
    name: 'Grove',
    industry: 'AI Marketing Software / B2B SaaS',
    products_services: [
      'Autonomous AI blog writing',
      'One-line embed blog hosting',
      'Automated SEO strategy and topical clustering',
      'Auto-posting to X and LinkedIn',
      'Content quality scoring agent',
      'Publishing integrations (Webhook, Zapier, RSS, JSON API)',
    ],
    value_props: [
      'Zero upkeep and no dashboards to babysit',
      'One-line embed with no CMS wiring or plugins required',
      'Learns and replicates your exact brand voice',
      'Built to rank on Google and get cited by ChatGPT',
      'Automated hub-and-spoke content strategy',
    ],
  },
} as any;

/** oveners.com — a real customer, same shape, different industry. */
const OVEN = {
  business: {
    name: 'Oven AI',
    industry: 'AI Design Software / SaaS',
    products_services: [
      'AI 3D icon generator',
      'Automatic background removal',
      'Brand style memory / custom style training',
      'Figma plugin',
      'REST API for image generation',
    ],
    value_props: [
      'Pay-as-you-bake pricing (no subscription bloat)',
      'Studio-grade lighting and quality',
      'Fast render speeds (~6 seconds)',
      'Versatile export formats (PNG, WEBP, SVG, GLB)',
    ],
  },
} as any;

describe('seedCandidates — the measured failures, rule by rule', () => {
  it('splits an "and" bullet into two searchable halves', () => {
    // "Automated SEO strategy and topical clustering" → 0 suggestions.
    // "seo strategy" → 10. "topical clustering" → 10.
    expect(seedCandidates('Automated SEO strategy and topical clustering')).toEqual([
      'seo strategy',
      'topical clustering',
    ]);
  });

  it('splits on "/" — the industry field is two categories, not one', () => {
    // "AI Marketing Software / B2B SaaS" → 0. Both halves → 10.
    expect(seedCandidates('AI Marketing Software / B2B SaaS')).toEqual([
      'ai marketing software',
      'b2b saas',
    ]);
  });

  it('splits on "for" — "REST API for image generation" is two things', () => {
    expect(seedCandidates('REST API for image generation')).toEqual(['rest api', 'image generation']);
  });

  it('drops parentheticals, which are always asides', () => {
    expect(seedCandidates('Publishing integrations (Webhook, Zapier, RSS, JSON API)')).toEqual([
      'publishing integrations',
    ]);
    expect(seedCandidates('Pay-as-you-bake pricing (no subscription bloat)')).toEqual([
      'pay-as-you-bake pricing',
    ]);
  });

  it('strips leading marketing adjectives nobody types', () => {
    expect(seedCandidates('Autonomous AI blog writing')).toEqual(['ai blog writing']);
    expect(seedCandidates('Automatic background removal')).toEqual(['background removal']);
  });

  it('strips the adjective even at three words — measured, not assumed', () => {
    // My first guess was that "custom" was distinguishing and should survive.
    // The endpoint disagreed: "custom style training" → 0 suggestions,
    // "style training" → 10. Stripping is what recovers the seed.
    expect(seedCandidates('custom style training')).toEqual(['style training']);
  });

  it('keeps a single word when it IS the whole field', () => {
    // A one-word industry ("Bakery") is the business's own category and
    // returns useful suggestions; only fragments of a longer sentence are junk.
    expect(seedCandidates('Bakery')).toEqual(['bakery']);
  });

  it(`drops clauses longer than ${MAX_SEED_WORDS} words — autocomplete returns nothing`, () => {
    // The measured cliff: 6-word phrases return 0.
    expect(seedCandidates('Brand style memory for consistent assets across a product suite')).not.toContain(
      'consistent assets across a product suite',
    );
    // "learns" survives the length rule but is a stray verb from a split
    // sentence. It DOES return suggestions ("learns", "learnus") — real and
    // irrelevant, which is worse than none.
    expect(seedCandidates('Learns and replicates your exact brand voice')).toEqual([]);
  });

  it('drops pure scaffolding and sub-3-character fragments', () => {
    // "Auto-posting to X and LinkedIn" — "x" is not a seed.
    expect(seedCandidates('Auto-posting to X and LinkedIn')).not.toContain('x');
    expect(seedCandidates('and or the')).toEqual([]);
  });

  it('returns nothing for an empty or junk input rather than throwing', () => {
    expect(seedCandidates('')).toEqual([]);
    expect(seedCandidates('   ')).toEqual([]);
    expect(seedCandidates('(((')).toEqual([]);
  });
});

describe('isBrandTerm — brand queries are how a blog ends up writing about itself', () => {
  it('matches the brand as a word and glued to a suffix', () => {
    expect(isBrandTerm('grove ai', 'Grove')).toBe(true);
    expect(isBrandTerm('groveai', 'Grove')).toBe(true);
    expect(isBrandTerm('grove-ai alternatives', 'Grove')).toBe(true);
  });

  it('does not swallow phrases that merely contain the letters', () => {
    expect(isBrandTerm('seo strategy', 'Grove')).toBe(false);
    // "grovel" is not "grove" — the squashed check is length-bounded so a long
    // unrelated phrase cannot match on a substring.
    expect(isBrandTerm('groveling for backlinks is bad seo', 'Grove')).toBe(false);
  });

  it('errs toward exclusion when the brand appears as a word', () => {
    // "olive grove irrigation" is not a brand query, but for a company called
    // Grove it is excluded anyway. Losing one of eight research slots is
    // cheaper than seeding research with the brand's own name.
    expect(isBrandTerm('olive grove irrigation', 'Grove')).toBe(true);
  });

  it('refuses to exclude on a too-generic brand', () => {
    // Excluding every phrase containing "AI" would empty the seed list.
    expect(isBrandTerm('ai blog writing', 'AI')).toBe(false);
  });
});

describe('searchSeeds — end to end on real profiles', () => {
  it("turns grove's zero-yield profile into head terms that return results", () => {
    const seeds = searchSeeds(GROVE, { limit: 8 });
    // Each of these was measured at 10 autocomplete suggestions.
    expect(seeds).toContain('ai blog writing');
    expect(seeds).toContain('seo strategy');
    expect(seeds).toContain('topical clustering');
    // And none of the raw strings, all of which were measured at 0.
    expect(seeds).not.toContain('autonomous ai blog writing');
    expect(seeds).not.toContain('automated seo strategy and topical clustering');
  });

  it('researches products before value_props — claims are the least searchable', () => {
    const seeds = searchSeeds(GROVE, { limit: 4 });
    // With the cap biting, nothing from value_props should survive.
    expect(seeds).not.toContain('hub-and-spoke content strategy');
    expect(seeds.length).toBe(4);
  });

  it('handles a different industry without special-casing', () => {
    const seeds = searchSeeds(OVEN, { limit: 8 });
    expect(seeds).toContain('background removal');
    expect(seeds).toContain('figma plugin');
    expect(seeds).toContain('ai design software');
  });

  it('excludes the brand name from its own research', () => {
    const branded = { business: { ...GROVE.business, products_services: ['Grove AI blog agent'] } } as any;
    expect(searchSeeds(branded)).not.toContain('grove ai blog agent');
  });

  it('never yields a seed longer than the autocomplete ceiling', () => {
    for (const p of [GROVE, OVEN]) {
      for (const s of searchSeeds(p, { limit: 20 })) {
        expect(s.split(' ').length).toBeLessThanOrEqual(MAX_SEED_WORDS);
      }
    }
  });

  it('is empty-safe on a profile that has not been built yet', () => {
    expect(searchSeeds(null)).toEqual([]);
    expect(searchSeeds({ business: {} } as any)).toEqual([]);
  });
});

describe('narrowSeed — the second chance for a dead seed', () => {
  it('takes the head noun phrase, which is where English puts it', () => {
    // Measured: the left column returned 0 suggestions, the right returned 10.
    expect(narrowSeed('embed blog hosting')).toBe('blog hosting');
    expect(narrowSeed('content quality scoring agent')).toBe('scoring agent');
    expect(narrowSeed('brand style memory')).toBe('style memory');
  });

  it('returns null when there is nothing left to narrow', () => {
    // "publishing integrations" simply has no demand. That is an answer.
    expect(narrowSeed('publishing integrations')).toBeNull();
    expect(narrowSeed('saas')).toBeNull();
    expect(narrowSeed('')).toBeNull();
  });
});

describe('parseLocalizedSeeds', () => {
  it('strips list scaffolding a small model adds', () => {
    expect(parseLocalizedSeeds('1. 배경 제거\n- 피그마 플러그인\n* "이미지 생성 API"', 'ko')).toEqual([
      '배경 제거', '피그마 플러그인', '이미지 생성 API',
    ]);
  });

  it('rejects English echoed back — the exact bug being fixed', () => {
    // A small model asked to translate will sometimes return the input.
    // Letting that through sends English seeds to a Korean locale again.
    expect(parseLocalizedSeeds('background removal\nfigma plugin', 'ko')).toEqual([]);
  });

  it('keeps Latin-script output for a Latin-script language', () => {
    // languageVerdict returns 'unsure' for short Spanish, and only a confident
    // 'wrong' rejects — a doubtful seed costs one request, dropping it costs a
    // line of research.
    expect(parseLocalizedSeeds('eliminar fondo\nplugin de figma', 'es')).toEqual([
      'eliminar fondo', 'plugin de figma',
    ]);
  });

  it('drops blanks, over-long lines and duplicates', () => {
    const out = parseLocalizedSeeds('배경 제거\n\n배경 제거\n' + '가'.repeat(50), 'ko');
    expect(out).toEqual(['배경 제거']);
  });
});

describe('localizeSeeds', () => {
  // No beforeEach(mockReset) and a deliberate order: the English case runs
  // first (so "never called" is meaningful), then the throwing case, and only
  // then the resolving ones. Vitest reports a throwing mock implementation as
  // an unhandled rejection once that mock has previously been given a
  // mockResolvedValue or been through mockReset — even though the code under
  // test catches it, verified in isolation. This is a harness quirk; the order
  // avoids it without weakening what is asserted.

  it('does not call the model at all for English', async () => {
    const seeds = ['blog hosting', 'seo strategy'];
    expect(await localizeSeeds(seeds, 'en')).toBe(seeds);
    expect(fastLlmCall).not.toHaveBeenCalled();
  });

  it('keeps the English seeds when the model fails', async () => {
    vi.mocked(fastLlmCall).mockImplementation(async () => { throw new Error('fast LLM timeout'); });
    const seeds = ['background removal'];
    expect(await localizeSeeds(seeds, 'ko')).toBe(seeds);
  });

  it('keeps the English seeds when the model returns a malformed answer', async () => {
    // Destructuring `{ text }` off undefined throws — the same catch.
    vi.mocked(fastLlmCall).mockResolvedValue(undefined as any);
    const seeds = ['background removal'];
    expect(await localizeSeeds(seeds, 'ko')).toBe(seeds);
  });

  it('replaces the seeds with in-language phrases', async () => {
    vi.mocked(fastLlmCall).mockResolvedValue({ text: '\uBC30\uACBD \uC81C\uAC70\n\uD53C\uADF8\uB9C8 \uD50C\uB7EC\uADF8\uC778' });
    expect(await localizeSeeds(['background removal', 'figma plugin'], 'ko')).toEqual([
      '\uBC30\uACBD \uC81C\uAC70', '\uD53C\uADF8\uB9C8 \uD50C\uB7EC\uADF8\uC778',
    ]);
  });

  it('keeps the English seeds when the model answers in the wrong script', async () => {
    vi.mocked(fastLlmCall).mockResolvedValue({ text: 'background removal\nfigma plugin' });
    const seeds = ['background removal', 'figma plugin'];
    // Worst case is the behaviour that shipped before, never something worse.
    expect(await localizeSeeds(seeds, 'ko')).toBe(seeds);
  });
});
