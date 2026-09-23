import { describe, it, expect } from 'vitest';
import {
  demandFloor, isBuyerQuery, judgeSlot, gateSlots, demandFacts, MIN_MONTHLY_DEMAND, type DemandFact,
} from '../lib/keywords/demand-floor';
import { effectiveVolume, selectKeywords, type ScoredKeyword } from '../lib/keywords/opportunity';
import { groveDifficulty } from '../lib/keywords/difficulty';

describe('demandFloor', () => {
  it('is 50 a month', () => {
    expect(MIN_MONTHLY_DEMAND).toBe(50);
    expect(demandFloor(49, 'how to make 3d icons')).toBeNull();
    expect(demandFloor(50, 'how to make 3d icons')).toBe('demand');
  });

  it('lets a buyer-stage query through at 10', () => {
    expect(demandFloor(20, 'iconikai alternative')).toBe('buyer_intent');
    expect(demandFloor(9, 'iconikai alternative')).toBeNull();
  });

  it('unknown demand never passes', () => {
    expect(demandFloor(null, 'iconikai alternative')).toBeNull();
  });
});

describe('isBuyerQuery', () => {
  it.each([
    'iconikai alternative', 'canva vs figma', 'remove.bg pricing', 'best 3d icon tool for saas',
    'photoroom review', '누끼 프로그램 추천', '아이콘 생성기 가격', 'alternativa a canva', 'canva 替代',
  ])('buyer: %s', (q) => expect(isBuyerQuery(q)).toBe(true));

  it.each([
    'how to make 3d icons', '3d icon generator', 'best 3d icons', 'what is a background remover', '3d 아이콘 만들기',
  ])('not buyer: %s', (q) => expect(isBuyerQuery(q)).toBe(false));
});

const fact = (keyword: string, total: number | null, over: Partial<DemandFact> = {}): DemandFact =>
  ({ keyword, total, deadSpace: false, members: [], ...over });

describe('judgeSlot', () => {
  it('keeps a measured slot over the floor', () => {
    expect(judgeSlot({ topic: 't', target_keyword: 'a' }, fact('a', 400))).toEqual({ verdict: 'keep', pass: 'demand' });
  });

  it('replaces an invented keyword the provider has never heard of', () => {
    expect(judgeSlot({ topic: 't', target_keyword: 'why 3d icons matter for saas' }, undefined))
      .toEqual({ verdict: 'replace', reason: 'unmeasured' });
  });

  it('keeps an unmeasured buyer query — the database is known to miss them', () => {
    expect(judgeSlot({ topic: 't', target_keyword: 'iconikai alternative' }, undefined).verdict).toBe('keep');
  });

  it('replaces a slot aimed at dead space whatever its volume', () => {
    expect(judgeSlot({ topic: 't', target_keyword: 'a' }, fact('a', 5000, { deadSpace: true })))
      .toEqual({ verdict: 'replace', reason: 'dead_space' });
  });

  it('replaces a measured slot under the floor', () => {
    expect(judgeSlot({ topic: 't', target_keyword: 'a' }, fact('a', 20)))
      .toEqual({ verdict: 'replace', reason: 'too_small' });
  });
});

type Slot = { id: string; topic: string; target_keyword?: string; secondary_keywords?: string[]; notes?: string; publish_date?: string };

describe('gateSlots', () => {
  const facts = new Map([
    ['3d icon generator', fact('3d icon generator', 1200, { members: ['ai 3d icon generator'] })],
    ['free 3d icons', fact('free 3d icons', 300, { members: ['3d icons free download'] })],
    ['3d icon for app', fact('3d icon for app', 90)],
    ['tiny phrase', fact('tiny phrase', 20)],
  ]);
  const spare = [facts.get('3d icon generator')!, facts.get('free 3d icons')!, facts.get('3d icon for app')!];

  it('rewrites a failing slot onto the best UNUSED cluster, keeping its place in the calendar', () => {
    const slots: Slot[] = [
      { id: 's1', topic: 'Generators compared', target_keyword: '3d icon generator' },
      { id: 's2', topic: 'Why icons matter', target_keyword: 'why icons matter', notes: 'about icons', publish_date: '2026-10-08' },
    ];
    const { slots: out, changes } = gateSlots(slots, facts, spare);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(slots[0]);
    expect(out[1]).toMatchObject({
      id: 's2', publish_date: '2026-10-08', topic: 'free 3d icons', target_keyword: 'free 3d icons',
      secondary_keywords: ['3d icons free download'], notes: undefined,
    });
    expect(changes[0]).toMatch(/replaced "why icons matter" \(unmeasured\) with "free 3d icons"/);
  });

  it('drops a failing slot when no unused cluster is left', () => {
    const slots: Slot[] = [
      { id: 's1', topic: 'a', target_keyword: '3d icon generator' },
      { id: 's2', topic: 'b', target_keyword: 'free 3d icons' },
      { id: 's3', topic: 'c', target_keyword: '3d icon for app' },
      { id: 's4', topic: 'd', target_keyword: 'tiny phrase' },
    ];
    const { slots: out, changes } = gateSlots(slots, facts, spare);
    expect(out.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(changes[0]).toMatch(/dropped "tiny phrase" \(too_small, 20\/mo\)/);
  });

  it('never gates a month to zero', () => {
    const slots: Slot[] = [{ id: 's1', topic: 'a', target_keyword: 'invented one' }];
    const { slots: out, changes } = gateSlots(slots, new Map(), []);
    expect(out).toEqual(slots);
    expect(changes.at(-1)).toMatch(/kept all 1 original/);
  });

  it('never backfills from a dead or sub-floor cluster', () => {
    const slots: Slot[] = [{ id: 's1', topic: 'a', target_keyword: 'x' }, { id: 's2', topic: 'b', target_keyword: '3d icon generator' }];
    const bad = [fact('giant', 9000, { deadSpace: true }), fact('small', 30)];
    const { slots: out } = gateSlots(slots, facts, bad);
    expect(out.map((s) => s.id)).toEqual(['s2']);
  });
});

describe('demandFacts', () => {
  const k = (keyword: string, volume: number | null, over: Partial<ScoredKeyword> = {}): ScoredKeyword =>
    ({ keyword, volume, difficulty: 10, intent: null, source: 'dataforseo', ...over });

  it('a pillar is worth its cluster total; any other phrase its own demand', () => {
    const pillar = k('3d icon generator', 20, { revealed: { impressions: 1120, clicks: 16, position: 13.5, days: 28 } });
    const f = demandFacts([pillar, k('3d icon maker', 20)], [{ pillar, members: [k('ai 3d icon generator', 30)], totalVolume: 1250 }], effectiveVolume);
    expect(f.get('3d icon generator')).toMatchObject({ total: 1250, members: ['ai 3d icon generator'] });
    expect(f.get('3d icon maker')?.total).toBe(20);
  });

  it('carries the dead-space verdict', () => {
    const dead = k('illustrator 3d logo', 30, { assessment: groveDifficulty(0, { domainRank: 842, pageRank: 13, referringDomains: 0.6, features: [] }) });
    expect(demandFacts([dead], [], effectiveVolume).get('illustrator 3d logo')?.deadSpace).toBe(true);
  });
});

describe('selectKeywords with grove difficulty', () => {
  const k = (keyword: string, volume: number, providerKd: number, domainRank: number): ScoredKeyword => {
    const a = groveDifficulty(providerKd, { domainRank, pageRank: 10, referringDomains: 1, features: [] });
    return { keyword, volume, difficulty: a.score, providerKd, intent: null, source: 'dataforseo', assessment: a };
  };

  it('rejects the KD-0 traps and keeps the winnable one', () => {
    const s = selectKeywords([
      k('pixel 3d icon pack', 4400, 0, 599.2),
      k('3d icon ios', 170, 0, 689.8),
      k('3d icon generator', 900, 21, 426.5),
    ]);
    expect(s.chosen.map((c) => c.keyword)).toEqual(['3d icon generator']);
    expect(s.rejected).toEqual(expect.arrayContaining([
      { keyword: 'pixel 3d icon pack', reason: 'too_hard' },
      { keyword: '3d icon ios', reason: 'dead_space' },
    ]));
  });

  it('dead space is not kept as long tail either', () => {
    const s = selectKeywords([k('illustrator 3d logo', 30, 0, 841.8)]);
    expect(s.longTail).toHaveLength(0);
  });

  it('a buyer query under 50 may lead', () => {
    const s = selectKeywords([k('iconikai alternative', 20, 5, 300)]);
    expect(s.chosen.map((c) => c.keyword)).toEqual(['iconikai alternative']);
  });
});
