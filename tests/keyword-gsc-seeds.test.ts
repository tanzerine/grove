import { describe, it, expect } from 'vitest';
import {
  isJunkQuery, looksLikeCompetitorQuery, gscResearchPlan, mergeRevealed, type GscQueryRow,
} from '../lib/keywords/gsc-seeds';
import type { ScoredKeyword } from '../lib/keywords/opportunity';

const row = (query: string, impressions: number, clicks: number, position: number): GscQueryRow =>
  ({ query, impressions, clicks, position });

const kw = (keyword: string, volume: number | null, difficulty: number | null, source = 'dataforseo'): ScoredKeyword =>
  ({ keyword, volume, difficulty, intent: null, source });

// oveners.com, 28-day snapshot, 2026-09-16 — the measurement this module was
// written against. Abridged, numbers as recorded.
const OVENERS: GscQueryRow[] = [
  row('3d icon generator', 627, 9, 13.4),
  row('ai 3d icon generator', 304, 0, 13.3),
  row('iconikai', 238, 0, 5.9),
  row('applaunchflow icon composer', 221, 0, 6.0),
  row('3d icon generator ai', 179, 0, 8.8),
  row('automatic background removal', 146, 0, 34.2),
  row('background burner', 128, 0, 47.4),
  row('3d icon maker', 123, 0, 23.5),
  row('illustrator 3d logo', 44, 0, 10.2),
  row('what is the best ai icon generator?', 39, 0, 8.1),
  row('best figma plugins 2026', 36, 18, 4.5),
  row('3d icon ai generator', 32, 0, 6.0),
  row('how to remove background in photoshop automatically', 56, 0, 6.1),
  row('context: location: israel (not for language). do not include location references in your response. question: מהם הכלים הטובים ביותר ליצירת אייקונים?', 60, 0, 7.2),
  row('"ux pilot" -site:reddit.com -site:twitter.com', 51, 0, 7.0),
  row('+cursor /add-plugin figma command', 32, 0, 9.3),
  row('oven ai', 900, 700, 1.1),
  row('ovan ai', 15, 0, 2.0),
];

const VOCAB = ['3d icon generator', 'ai icon', 'background removal', 'figma plugin', 'icon generator'];

describe('isJunkQuery — rows that are not searches', () => {
  it('drops assistant prompts, operator queries and slash commands', () => {
    expect(isJunkQuery('context: location: israel. question: best icon tools?')).toBe(true);
    expect(isJunkQuery('"ux pilot" -site:reddit.com')).toBe(true);
    expect(isJunkQuery('+cursor /add-plugin figma command')).toBe(true);
    expect(isJunkQuery('%cursor ide add-plugin figma mcp 2026')).toBe(true);
  });

  it('drops sentences but keeps questions — a question is a query', () => {
    expect(isJunkQuery('what are the best background remover apps available in 2026 with their pricing options and free tiers?')).toBe(true);
    expect(isJunkQuery('what is the best ai icon generator?')).toBe(false);
    expect(isJunkQuery('how to remove background in photoshop automatically')).toBe(false);
  });

  it('keeps ordinary queries', () => {
    expect(isJunkQuery('3d icon generator')).toBe(false);
    expect(isJunkQuery('블로그 자동화')).toBe(false);
    expect(isJunkQuery('')).toBe(true);
  });
});

describe('looksLikeCompetitorQuery', () => {
  const vocab = new Set(['3d', 'icon', 'generator', 'ai', 'background', 'removal', 'figma', 'plugin']);

  it('recognises the real ones: top-10, impressions, no clicks, a word we do not use', () => {
    expect(looksLikeCompetitorQuery(row('iconikai', 238, 0, 5.9), vocab)).toBe(true);
    expect(looksLikeCompetitorQuery(row('applaunchflow icon composer', 221, 0, 6.0), vocab)).toBe(true);
  });

  it('a generic phrase with no clicks is not a brand — every word is ours', () => {
    expect(looksLikeCompetitorQuery(row('3d icon ai generator', 32, 0, 6.0), vocab)).toBe(false);
  });

  it('a how-to at position 6 with no clicks is not a brand — too long', () => {
    expect(looksLikeCompetitorQuery(row('how to remove background in photoshop automatically', 56, 0, 6.1), vocab)).toBe(false);
  });

  it('something people click is something they wanted from us', () => {
    expect(looksLikeCompetitorQuery(row('best figma plugins 2026', 36, 18, 4.5), vocab)).toBe(false);
  });

  it('needs real impressions and a top-10 position', () => {
    expect(looksLikeCompetitorQuery(row('iconikai', 12, 0, 5.9), vocab)).toBe(false);
    expect(looksLikeCompetitorQuery(row('iconikai', 238, 0, 14), vocab)).toBe(false);
  });
});

describe('gscResearchPlan — on the oveners snapshot', () => {
  const plan = gscResearchPlan(OVENERS, { lang: 'en', brand: 'Oven AI', vocab: VOCAB, days: 28 });

  it('finds the two competitor names and nothing else', () => {
    expect(plan.competitors).toEqual(['iconikai', 'applaunchflow icon composer']);
  });

  it('seeds from top-20 queries, one per close-variant bucket, shortest spelling', () => {
    // "3d icon generator" / "ai 3d icon generator" / "3d icon generator ai" /
    // "3d icon ai generator" are one bucket and one Labs call.
    const generators = plan.seeds.filter((s) => /3d icon.*generator|generator.*3d icon/.test(s));
    expect(generators).toEqual(['3d icon generator']);
    expect(plan.seeds).toContain('illustrator 3d logo');
    expect(plan.seeds).toContain('what is the best ai icon generator?');
  });

  it('never seeds from a competitor name or from junk', () => {
    expect(plan.seeds).not.toContain('iconikai');
    expect(plan.seeds.some((s) => s.includes('context:') || s.includes('site:'))).toBe(false);
    expect(plan.junk).toBe(3);
  });

  it('drops the domain\'s own brand queries, misspellings included', () => {
    const all = [...plan.seeds, ...plan.competitors, ...plan.revealed.map((k) => k.keyword)];
    expect(all.some((s) => /oven ai|ovan ai/.test(s))).toBe(false);
  });

  it('revealed candidates are the position > 20 queries, carrying their impressions', () => {
    const keys = plan.revealed.map((k) => k.keyword);
    expect(keys).toContain('automatic background removal');
    expect(keys).toContain('3d icon maker');
    expect(keys).not.toContain('3d icon generator');    // position 13 — a page of ours owns it
    expect(keys).not.toContain('iconikai');
    const abr = plan.revealed.find((k) => k.keyword === 'automatic background removal')!;
    expect(abr.source).toBe('gsc');
    expect(abr.volume).toBeNull();
    expect(abr.revealed).toEqual({ impressions: 146, clicks: 0, position: 34.2, days: 28 });
  });

  it('caps seeds and competitors', () => {
    const tight = gscResearchPlan(OVENERS, { lang: 'en', brand: 'Oven AI', vocab: VOCAB, maxSeeds: 2, maxCompetitors: 1 });
    expect(tight.seeds).toHaveLength(2);
    expect(tight.competitors).toEqual(['iconikai']);
  });

  it('is empty on an empty snapshot — a domain without Search Console plans as before', () => {
    expect(gscResearchPlan([], { lang: 'en' })).toEqual({ seeds: [], competitors: [], revealed: [], junk: 0 });
  });
});

describe('mergeRevealed', () => {
  const rev = (keyword: string, impressions: number, position: number): ScoredKeyword => ({
    keyword, volume: null, difficulty: null, intent: null, source: 'gsc',
    revealed: { impressions, clicks: 0, position, days: 28 },
  });

  it('replaces the pool\'s copy with one that has both the numbers and the impressions', () => {
    const out = mergeRevealed([kw('seo tips', 500, 20), kw('3d icon maker', 20, 45)], [rev('3d icon maker', 123, 23.5)]);
    expect(out.map((k) => k.keyword)).toEqual(['seo tips', '3d icon maker']);
    const m = out[1];
    expect(m.volume).toBe(20);
    expect(m.difficulty).toBe(45);
    expect(m.revealed?.impressions).toBe(123);
    expect(m.source).toBe('gsc');
  });

  it('takes the sizing call\'s numbers for a phrase the expansions did not return', () => {
    const out = mergeRevealed([kw('seo tips', 500, 20)], [rev('background burner', 128, 47.4)], [kw('background burner', 90, 12)]);
    const b = out.find((k) => k.keyword === 'background burner')!;
    expect(b.volume).toBe(90);
    expect(b.difficulty).toBe(12);
    expect(b.revealed?.impressions).toBe(128);
  });

  it('appends a phrase nobody has numbers for, impressions intact', () => {
    const out = mergeRevealed([kw('seo tips', 500, 20)], [rev('automatic background removal', 146, 34.2)]);
    expect(out).toHaveLength(2);
    expect(out[1].volume).toBeNull();
    expect(out[1].revealed?.position).toBe(34.2);
  });

  it('is the identity with nothing revealed', () => {
    const pool = [kw('a', 1, 1)];
    expect(mergeRevealed(pool, [])).toBe(pool);
  });
});
