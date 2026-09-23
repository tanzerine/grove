import { describe, it, expect } from 'vitest';
import { candidateRow, diffCandidates, shouldExclude, candidateMatch, mergePool } from '../lib/strategy/candidate-store';
import type { ScoredKeyword } from '../lib/keywords/opportunity';

const kw = (
  keyword: string, volume: number | null = null, difficulty: number | null = null,
  source = 'dataforseo',
): ScoredKeyword => ({ keyword, volume, difficulty, intent: 'informational', source });

const AT = '2026-09-13T00:00:00.000Z';
const at = () => AT;

describe('candidateRow', () => {
  it('stamps metrics_at only when a metric actually arrived', () => {
    // A never-measured keyword dated as if it were screened would make the
    // rejection-expiry rule below treat a guess as a fresh verdict.
    expect(candidateRow('d', kw('measured', 880, 22), 'en', 'seed', at).metrics_at).toBe(AT);
    expect(candidateRow('d', kw('unmeasured', null, null, 'autocomplete'), 'en', 'seed', at).metrics_at).toBeNull();
  });

  it('stamps metrics_at when only one of the two is known', () => {
    expect(candidateRow('d', kw('vol only', 500, null), 'en', null, at).metrics_at).toBe(AT);
    expect(candidateRow('d', kw('kd only', null, 12), 'en', null, at).metrics_at).toBe(AT);
  });

  it('maps to the columns the CHECK constraints accept', () => {
    const row = candidateRow('dom-1', kw('blog automation', 880, 22), 'ko', 'blog', at);
    expect(row).toMatchObject({
      domain_id: 'dom-1', keyword: 'blog automation', lang: 'ko',
      source: 'dataforseo', seed: 'blog', volume: 880, difficulty: 22,
      intent: 'informational',
    });
  });

  it('coerces an unknown source to autocomplete rather than failing the insert', () => {
    // 0041 CHECKs `source`; an unrecognised value would reject the whole chunk.
    expect(candidateRow('d', kw('x', null, null, 'semrush'), 'en', null, at).source).toBe('autocomplete');
    expect(candidateRow('d', kw('x', null, null, 'gsc'), 'en', null, at).source).toBe('gsc');
  });

  it('trims the keyword so it matches the lower(keyword) unique index', () => {
    expect(candidateRow('d', kw('  spaced  '), 'en', null, at).keyword).toBe('spaced');
  });
});

describe('diffCandidates', () => {
  it('splits new from already-known, case-insensitively', () => {
    const out = diffCandidates(['Blog Automation'], [kw('blog automation'), kw('new phrase')]);
    expect(out.toInsert.map((c) => c.keyword)).toEqual(['new phrase']);
    expect(out.toTouch).toEqual(['blog automation']);
  });

  it('collapses repeats inside one batch', () => {
    // Two seeds can expand to the same phrase; inserting both would hit the
    // unique index and lose the chunk.
    const out = diffCandidates([], [kw('same'), kw('Same'), kw('  same  ')]);
    expect(out.toInsert).toHaveLength(1);
  });

  it('drops empty keywords', () => {
    expect(diffCandidates([], [kw('  '), kw('real')]).toInsert.map((c) => c.keyword)).toEqual(['real']);
  });

  it('inserts everything when the domain is new', () => {
    const out = diffCandidates([], [kw('a'), kw('b')]);
    expect(out.toInsert).toHaveLength(2);
    expect(out.toTouch).toEqual([]);
  });
});

describe('shouldExclude', () => {
  const now = new Date('2026-09-13T00:00:00Z');

  it('permanently excludes what is already planned or published', () => {
    // Two of our own pages targeting one query is cannibalisation.
    expect(shouldExclude({ status: 'planned', metrics_at: null }, now, 90)).toBe(true);
    expect(shouldExclude({ status: 'published', metrics_at: null }, now, 90)).toBe(true);
  });

  it('lets a fresh rejection stand', () => {
    const recent = new Date(now.getTime() - 10 * 86_400_000).toISOString();
    expect(shouldExclude({ status: 'rejected', metrics_at: recent }, now, 90)).toBe(true);
  });

  it('EXPIRES a stale rejection — difficulty is relative to a domain that grows', () => {
    // The rule that keeps the blog from being permanently capped at whatever
    // its authority was on day one.
    const old = new Date(now.getTime() - 200 * 86_400_000).toISOString();
    expect(shouldExclude({ status: 'rejected', metrics_at: old }, now, 90)).toBe(false);
  });

  it('re-screens a rejection that was never measured', () => {
    expect(shouldExclude({ status: 'rejected', metrics_at: null }, now, 90)).toBe(false);
  });

  it('never excludes an untouched candidate', () => {
    expect(shouldExclude({ status: 'new', metrics_at: null }, now, 90)).toBe(false);
  });

  it('survives an unparseable timestamp by re-screening rather than excluding', () => {
    expect(shouldExclude({ status: 'rejected', metrics_at: 'not-a-date' }, now, 90)).toBe(false);
  });
});

describe('candidateMatch', () => {
  it('requires strategy_id — slot ids REPEAT across months', () => {
    // "slot-3" exists in every strategy a domain has ever had. Matching on
    // (domain_id, slot_id) alone would mark this month's article as the
    // outcome of a keyword chosen last March.
    expect(candidateMatch({ domain_id: 'd', slot_id: 'slot-3', strategy_id: 's' }))
      .toEqual({ domain_id: 'd', slot_id: 'slot-3', strategy_id: 's' });
    expect(candidateMatch({ domain_id: 'd', slot_id: 'slot-3' })).toBeNull();
  });

  it('returns null for a hand-written post, which never came from a plan', () => {
    // Write-page posts carry no slot; there is no candidate to close.
    expect(candidateMatch({ domain_id: 'd', slot_id: null, strategy_id: null })).toBeNull();
    expect(candidateMatch({ domain_id: 'd' })).toBeNull();
  });

  it('is null-safe on a missing post', () => {
    expect(candidateMatch(null)).toBeNull();
    expect(candidateMatch(undefined)).toBeNull();
    expect(candidateMatch({})).toBeNull();
  });

  it('treats an empty string as missing, not as a match', () => {
    expect(candidateMatch({ domain_id: '', slot_id: 'slot-1', strategy_id: 's' })).toBeNull();
    expect(candidateMatch({ domain_id: 'd', slot_id: '', strategy_id: 's' })).toBeNull();
  });
});

describe('mergePool', () => {
  const k = (keyword: string, volume: number) => ({ keyword, volume, difficulty: 10, intent: null, source: 'dataforseo' });
  it('takes this month\'s metrics over the ledger\'s for the same phrase, and lists nothing twice', () => {
    const out = mergePool([k('Content Marketing Agency', 3600), k('ai seo agent', 500)], [k('content marketing agency', 3100), k('topical authority', 320), k('ai seo agent', 480)]);
    expect(out.map((c) => [c.keyword, c.volume])).toEqual([
      ['Content Marketing Agency', 3600],
      ['ai seo agent', 500],
      ['topical authority', 320],
    ]);
  });
  it('is the ledger alone when research returned nothing', () => {
    expect(mergePool([], [k('topical authority', 320)]).map((c) => c.keyword)).toEqual(['topical authority']);
  });
});

describe('candidateRow — the ledger stores the PROVIDER KD', () => {
  it('writes providerKd, not grove difficulty, so a re-read is never mistaken for a fresh assessment', () => {
    const row = candidateRow('d1', {
      keyword: 'illustrator 3d logo', volume: 30, difficulty: 100, providerKd: 0,
      intent: null, source: 'dataforseo',
    }, 'en', null, () => 'T');
    expect(row.difficulty).toBe(0);
  });

  it('falls back to difficulty for sources that never had a provider KD', () => {
    const row = candidateRow('d1', { keyword: 'x', volume: 10, difficulty: 12, intent: null, source: 'manual' }, 'en', null, () => 'T');
    expect(row.difficulty).toBe(12);
  });
});
