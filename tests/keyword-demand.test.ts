import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  classifyIntent,
  rankSuggestions,
  formatDemandForPrompt,
  gatherKeywordDemand,
} from '../lib/strategy/keywords';

describe('classifyIntent', () => {
  it('flags transactional phrases', () => {
    expect(classifyIntent('buy ergonomic chair')).toBe('transactional');
    expect(classifyIntent('crm pricing')).toBe('transactional');
  });
  it('flags commercial-investigation phrases', () => {
    expect(classifyIntent('best crm for startups')).toBe('commercial');
    expect(classifyIntent('notion vs obsidian')).toBe('commercial');
    expect(classifyIntent('project management tools')).toBe('commercial');
  });
  it('flags navigational phrases', () => {
    expect(classifyIntent('slack login')).toBe('navigational');
    expect(classifyIntent('figma.com')).toBe('navigational');
  });
  it('defaults to informational', () => {
    expect(classifyIntent('how to brew filter coffee')).toBe('informational');
    expect(classifyIntent('what is a sales funnel')).toBe('informational');
  });
});

describe('rankSuggestions', () => {
  it('ranks earlier positions higher and accumulates across lists', () => {
    const lists = [
      ['email marketing', 'email marketing tips', 'email marketing software'],
      ['email marketing', 'email marketing examples'],
    ];
    const out = rankSuggestions(lists);
    // "email marketing" leads both lists → highest accumulated score, ranked first
    expect(out[0].keyword).toBe('email marketing');
    expect(out[0].score).toBeGreaterThan(out[1].score);
    // intent is attached
    expect(out.find((i) => i.keyword === 'email marketing software')?.intent).toBe('commercial');
  });

  it('drops junk and respects the limit', () => {
    const lists = [['ok phrase', 'a', '   ', 'bad{stuff}', 'another good one']];
    const out = rankSuggestions(lists, 2);
    expect(out.length).toBe(2);
    expect(out.map((i) => i.keyword)).not.toContain('a');             // too short
    expect(out.map((i) => i.keyword)).not.toContain('bad{stuff}');    // junk chars
  });
});

describe('formatDemandForPrompt', () => {
  it('groups by intent and labels the funnel mapping', () => {
    const block = formatDemandForPrompt([
      { keyword: 'how to start a blog', intent: 'informational', score: 5 },
      { keyword: 'best blogging platform', intent: 'commercial', score: 4 },
    ]);
    expect(block).toContain('INFORMATIONAL');
    expect(block).toContain('how to start a blog');
    expect(block).toContain('COMMERCIAL');
  });
  it('returns a clear empty marker', () => {
    expect(formatDemandForPrompt([])).toMatch(/none captured/i);
  });
});

describe('gatherKeywordDemand', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses the firefox autocomplete shape and ranks results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify(['seed', ['crm software', 'crm pricing', 'best crm']]), { status: 200 }),
    ));
    const out = await gatherKeywordDemand(['crm'], { maxSeeds: 1, limit: 10 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((i) => i.keyword)).toContain('crm software');
  });

  it('fails soft to [] when the network throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const out = await gatherKeywordDemand(['crm'], { maxSeeds: 1 });
    expect(out).toEqual([]);
  });

  it('returns [] for empty seeds without calling fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const out = await gatherKeywordDemand(['', '   ']);
    expect(out).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
