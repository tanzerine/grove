import { describe, it, expect } from 'vitest';
import {
  demandFloor, isBuyerQuery, judgeSlot, gateSlots, demandFacts, MIN_MONTHLY_DEMAND, type DemandFact,
} from '../lib/keywords/demand-floor';
import { effectiveVolume, selectKeywords, type ScoredKeyword } from '../lib/keywords/opportunity';

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
  ({ keyword, total, members: [], ...over });

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

  it('never backfills from a sub-floor cluster', () => {
    const slots: Slot[] = [{ id: 's1', topic: 'a', target_keyword: 'x' }, { id: 's2', topic: 'b', target_keyword: '3d icon generator' }];
    const bad = [fact('small', 30), fact('smaller', 12)];
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
});

describe('selectKeywords with the floor', () => {
  const k = (keyword: string, volume: number, difficulty: number): ScoredKeyword =>
    ({ keyword, volume, difficulty, intent: null, source: 'dataforseo' });

  it('a buyer query under 50 may lead; an informational one may not', () => {
    const s = selectKeywords([k('iconikai alternative', 20, 5), k('how to make 3d icons', 20, 5)]);
    expect(s.chosen.map((c) => c.keyword)).toEqual(['iconikai alternative']);
    expect(s.longTail.map((c) => c.keyword)).toEqual(['how to make 3d icons']);
  });
});
