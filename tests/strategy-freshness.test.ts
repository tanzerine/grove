import { describe, it, expect } from 'vitest';
import {
  AUTO_REBUILD_REASONS,
  PLAN_PIPELINE_EPOCH,
  REFRESH_COOLDOWN_HOURS,
  planFreshness,
  planLanguageMatches,
  planPredatesPipeline,
  planReaderText,
  refreshCooledDown,
  type FreshnessInput,
} from '../lib/strategy/freshness';
import type { Pillar, PostSlot } from '../lib/strategy/build';

const at = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h));

const pillar = (title: string): Pillar =>
  ({ id: `p-${title.slice(0, 4)}`, title, audience: '', promise: '', target_keywords: [] }) as unknown as Pillar;

const slot = (topic: string, kw = ''): PostSlot =>
  ({ id: `s-${topic.slice(0, 4)}`, pillar_id: 'p', topic, target_keyword: kw, intent: 'editorial' }) as unknown as PostSlot;

/** An English plan long enough for languageVerdict to judge (it needs 200 chars). */
const enPlan = {
  pillars: [pillar('Founder SEO playbooks'), pillar('Content ops for engineering-led teams')],
  publishing_plan: [
    slot('How I automate my SEO so I can keep shipping code instead of writing marketing posts', 'automate seo'),
    slot('Topical authority for solo founders: the boring version that actually compounds', 'topical authority'),
    slot('Why your landing page copy is not the reason nobody is finding your product', 'landing page seo'),
  ],
};

/** The shape of www.oveners.com's live plan: entirely Korean. */
const koPlan = {
  pillars: [pillar('페이지 2 근접 승자 뒤에 붙이는 다음 질문 글'), pillar('피그마 플러그인 클러스터 실무 워크플로우 심화')],
  publishing_plan: [
    slot('앱 아이콘용 3D 아이콘, 어떤 사이즈와 해상도로 뽑아야 iOS·안드로이드·웹에서 다 깨지지 않을까', '3d 아이콘 사이즈'),
    slot('포토샵에서 배경을 지운 뒤 남는 가장자리 픽셀과 헤일로를 5분 안에 정리하는 법', '배경 제거 가장자리'),
    slot('3D 아이콘 팩을 직접 만들 때 스타일 일관성을 유지하는 다섯 가지 원칙', '3d 아이콘 팩'),
  ],
};

const base: FreshnessInput = {
  month: '2026-09-01',
  createdAt: '2026-09-20T10:00:00.000Z',   // after the epoch
  hasKeywordLedger: true,
  hasCustomerProfile: true,
  strategy: enPlan,
  lang: 'en',
  now: at(2026, 9, 25),
};

describe('planReaderText — only the half that becomes articles', () => {
  it('takes pillar titles, slot topics and target keywords', () => {
    const text = planReaderText({
      pillars: [pillar('Founder SEO playbooks')],
      publishing_plan: [slot('Automate your SEO', 'automate seo')],
    });
    expect(text).toContain('Founder SEO playbooks');
    expect(text).toContain('Automate your SEO');
    expect(text).toContain('automate seo');
  });

  it('is empty, not a crash, for a plan with nothing in it', () => {
    expect(planReaderText(null)).toBe('');
    expect(planReaderText({ pillars: [], publishing_plan: [] })).toBe('');
  });
});

describe('planLanguageMatches — conservative, like languageVerdict', () => {
  it('flags a Korean plan on a domain configured for English', () => {
    expect(planLanguageMatches(koPlan, 'en')).toBe(false);
  });

  it('accepts a Korean plan on a Korean domain', () => {
    expect(planLanguageMatches(koPlan, 'ko')).toBe(true);
  });

  it('flags an English plan on a Korean domain', () => {
    expect(planLanguageMatches(enPlan, 'ko')).toBe(false);
  });

  it('abstains on a plan too short to judge rather than guessing', () => {
    expect(planLanguageMatches({ pillars: [pillar('Growth')], publishing_plan: [] }, 'ko')).toBe(true);
  });

  it('abstains between Latin-script languages no character can tell apart', () => {
    // en vs es is exactly the case languageVerdict returns 'unsure' for on a
    // body this short — the quiet answer has to be "leave it alone".
    expect(planLanguageMatches(enPlan, 'es')).toBe(true);
  });
});

describe('planPredatesPipeline — the epoch is what stops the rebuild loop', () => {
  it('is true for a plan written before the epoch', () => {
    expect(planPredatesPipeline('2026-09-06T07:48:56.822Z')).toBe(true);
  });

  it('is false for a plan written after it', () => {
    expect(planPredatesPipeline('2026-09-13T12:13:01.829Z')).toBe(false);
  });

  it('never rebuilds on an unknown or unparseable age', () => {
    expect(planPredatesPipeline(null)).toBe(false);
    expect(planPredatesPipeline('')).toBe(false);
    expect(planPredatesPipeline('not a date')).toBe(false);
  });

  it('takes the epoch as an argument so a test is not pinned to a release date', () => {
    expect(planPredatesPipeline('2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z')).toBe(true);
    expect(planPredatesPipeline('2026-01-04T00:00:00Z', '2026-01-03T00:00:00Z')).toBe(false);
  });
});

describe('planFreshness', () => {
  it('reports nothing for a current plan with every artifact', () => {
    const f = planFreshness(base);
    expect(f.reasons).toEqual([]);
    expect(f.stale).toBe(false);
    expect(f.autoRebuild).toBe(false);
  });

  it('flags a live plan whose month has ended', () => {
    const f = planFreshness({ ...base, month: '2026-08-01' });
    expect(f.reasons).toContain('month_ended');
    expect(f.autoRebuild).toBe(true);
  });

  it('flags a pre-epoch plan with no keyword ledger behind it', () => {
    // www.oveners.com, 2026-09-06: a fine plan, built a week before the ledger
    // existed, that nothing would ever ask to catch up.
    const f = planFreshness({
      ...base,
      createdAt: '2026-09-06T07:48:56.822Z',
      hasKeywordLedger: false,
      hasCustomerProfile: false,
    });
    expect(f.reasons).toEqual(expect.arrayContaining(['no_keyword_ledger', 'no_customer_profile']));
    expect(f.autoRebuild).toBe(true);
  });

  it('leaves a POST-epoch plan alone even with an empty ledger', () => {
    // After the epoch an empty ledger means the research found nothing for this
    // site — a rebuild would not change that, and would loop every tick.
    const f = planFreshness({ ...base, hasKeywordLedger: false, hasCustomerProfile: false });
    expect(f.reasons).toEqual([]);
    expect(f.autoRebuild).toBe(false);
  });

  it('cannot loop: a rebuild writes a row dated now, which is past the epoch', () => {
    const rebuilt = planFreshness({
      ...base,
      createdAt: new Date().toISOString(),
      hasKeywordLedger: false,      // the rebuild failed to find anything
      hasCustomerProfile: false,
      now: new Date(),
    });
    expect(rebuilt.autoRebuild).toBe(false);
  });

  it('reports a language mismatch but never rebuilds on it', () => {
    // Neither half is automatically wrong: www.oveners.com published 58 English
    // articles, then 11 Korean ones after its plan came back in Korean. Which
    // one is the real blog is the owner's call, not a guess code gets to make.
    const f = planFreshness({ ...base, strategy: koPlan, lang: 'en' });
    expect(f.reasons).toEqual(['language_mismatch']);
    expect(f.stale).toBe(true);
    expect(f.autoRebuild).toBe(false);
  });

  it('still rebuilds when a rebuildable reason sits alongside a language mismatch', () => {
    const f = planFreshness({ ...base, month: '2026-08-01', strategy: koPlan, lang: 'en' });
    expect(f.reasons).toEqual(expect.arrayContaining(['month_ended', 'language_mismatch']));
    expect(f.autoRebuild).toBe(true);
  });

  it('keeps language_mismatch out of the auto-rebuild set', () => {
    expect(AUTO_REBUILD_REASONS).not.toContain('language_mismatch');
  });

  it('pins the epoch to the day the keyword ledger and customer profile landed', () => {
    expect(PLAN_PIPELINE_EPOCH).toBe('2026-09-13T00:00:00.000Z');
  });
});

describe('refreshCooledDown — a stale plan is not an outage', () => {
  const now = at(2026, 9, 25, 12);

  it('lets a never-attempted domain through', () => {
    expect(refreshCooledDown(null, now)).toBe(true);
    expect(refreshCooledDown('nonsense', now)).toBe(true);
  });

  it('holds a domain attempted within the cooldown', () => {
    expect(refreshCooledDown(at(2026, 9, 25, 2).toISOString(), now)).toBe(false);
  });

  it('releases it once the cooldown has passed', () => {
    expect(refreshCooledDown(at(2026, 9, 24, 11).toISOString(), now)).toBe(true);
  });

  it('is a day, so a domain that cannot be planned costs one call a day', () => {
    expect(REFRESH_COOLDOWN_HOURS).toBe(24);
  });
});
