import { describe, it, expect } from 'vitest';
import {
  groveDifficulty, authorityDifficulty, linkDifficulty, parseSerpAuthority, parseHistoricalSerp,
  slotVerdict, withSlotVerdict, assess, GIANT_DOMAIN_RANK, type SerpAuthority, type SlotSnapshot,
} from '../lib/keywords/difficulty';

const serp = (domainRank: number, over: Partial<SerpAuthority> = {}): SerpAuthority =>
  ({ domainRank, pageRank: 10, referringDomains: 1, features: ['organic'], ...over });

// The five keywords measured live on 2026-09-23 — KD vs the top 10's average
// domain rank — and what oveners.com actually got for them.
describe('groveDifficulty — the measured cases', () => {
  it('3d icon generator (KD 21, dr 426): winnable, and oveners does rank 13.5 there', () => {
    const d = groveDifficulty(21, serp(426.5));
    expect(d.score).toBe(21);
    expect(d.deadSpace).toBe(false);
    expect(d.basis).toBe('serp');
  });

  it('pixel 3d icon pack (KD 0, dr 599): the KD-0 trap reads as hard, not free', () => {
    const d = groveDifficulty(0, serp(599.2));
    expect(d.score).toBeGreaterThan(45);   // past the young-domain maxDifficulty
    expect(d.reasons.join(' ')).toMatch(/harder than KD 0 says/);
  });

  it('illustrator 3d logo (KD 0, dr 842): dead space — ranked 9.7, zero clicks', () => {
    const d = groveDifficulty(0, serp(841.8));
    expect(d.score).toBe(100);
    expect(d.deadSpace).toBe(true);
  });

  it('orders the five the way the outcomes did, which KD alone inverted', () => {
    const cases: [string, number, number][] = [
      ['3d icon generator', 21, 426.5], ['pixel 3d icon pack', 0, 599.2],
      ['messenger 3d icon', 0, 648.7], ['3d icon ios', 0, 689.8], ['illustrator 3d logo', 0, 841.8],
    ];
    const scores = cases.map(([, kd, dr]) => groveDifficulty(kd, serp(dr)).score!);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
    expect(scores[0]).toBeLessThan(scores[1]);
  });
});

describe('groveDifficulty — the rules', () => {
  it('is the harder of the two walls, never a blend', () => {
    expect(groveDifficulty(60, serp(300)).score).toBe(60);   // links, small domains
    expect(groveDifficulty(5, serp(700)).score).toBe(88);    // no links, big domains
  });

  it('adds a penalty when the SERP is built for apps or products', () => {
    const plain = groveDifficulty(20, serp(400)).score!;
    const app = groveDifficulty(20, serp(400, { features: ['organic', 'app'] }));
    expect(app.score).toBe(plain + 15);
    expect(app.reasons.join(' ')).toMatch(/app/);
  });

  it('dead space starts at the giant threshold', () => {
    expect(groveDifficulty(0, serp(GIANT_DOMAIN_RANK - 1)).deadSpace).toBe(false);
    expect(groveDifficulty(0, serp(GIANT_DOMAIN_RANK)).deadSpace).toBe(true);
  });

  it('a low KD with no authority data is unknown, not easy', () => {
    expect(groveDifficulty(0, null)).toMatchObject({ score: null, basis: 'kd_only' });
    expect(groveDifficulty(14, null).score).toBeNull();
  });

  it('a KD high enough to mean something is used as-is without authority data', () => {
    expect(groveDifficulty(40, null)).toMatchObject({ score: 40, basis: 'kd_only' });
  });

  it('falls back to link counts when the provider sent no KD', () => {
    const d = groveDifficulty(null, serp(300, { referringDomains: 10.4 }));
    expect(d.score).toBe(linkDifficulty(10.4));
    expect(linkDifficulty(10.4)).toBeGreaterThanOrEqual(19);
    expect(linkDifficulty(10.4)).toBeLessThanOrEqual(23);
  });

  it('nothing at all is unknown', () => {
    expect(groveDifficulty(null, null)).toMatchObject({ score: null, basis: 'none', deadSpace: false });
  });

  it('authority wall is linear between its anchors and clamped outside', () => {
    expect(authorityDifficulty(200)).toBe(0);
    expect(authorityDifficulty(550)).toBe(50);
    expect(authorityDifficulty(1000)).toBe(100);
  });
});

describe('parseSerpAuthority', () => {
  it('treats a zero or missing domain rank as no data', () => {
    expect(parseSerpAuthority({})).toBeNull();
    expect(parseSerpAuthority({ avg_backlinks_info: { main_domain_rank: 0 } })).toBeNull();
    expect(parseSerpAuthority({ avg_backlinks_info: { main_domain_rank: 5000 } })).toBeNull();
  });

  it('reads the SERP element types alongside', () => {
    const a = parseSerpAuthority({
      avg_backlinks_info: { main_domain_rank: 500, rank: 20, referring_main_domains: 3 },
      serp_info: { serp_item_types: ['organic', 'app', 7] },
    });
    expect(a).toEqual({ domainRank: 500, pageRank: 20, referringDomains: 3, features: ['organic', 'app'] });
  });
});

describe('assess', () => {
  it('overwrites difficulty with grove\'s and keeps the provider KD', () => {
    const k = assess({ keyword: 'x', difficulty: 0, providerKd: 0, serp: serp(842) });
    expect(k.difficulty).toBe(100);
    expect(k.providerKd).toBe(0);
    expect(k.assessment.deadSpace).toBe(true);
  });
});

// ── per slot ──────────────────────────────────────────────────────────────

// Shaped from historical_serps as recorded 2026-09-23.
const snapJson = (datetime: string, slots: [string, number | null][]) => ({
  tasks: [{
    status_code: 20000,
    result: [{
      items: [{
        datetime,
        items: [
          { type: 'images' },
          ...slots.map(([domain, dr], i) => ({
            type: 'organic', rank_group: i + 1, domain,
            rank_info: dr == null ? null : { page_rank: 0, main_domain_rank: dr },
          })),
        ],
      }],
    }],
  }],
});

const NOW = new Date('2026-09-23T00:00:00Z');

describe('parseHistoricalSerp', () => {
  it('reads each organic slot with its domain rank, www stripped', () => {
    const s = parseHistoricalSerp(snapJson('2025-10-16 10:32:29 +00:00', [['www.adobe.com', 842], ['ndesign-studio.com', 545]]), NOW)!;
    expect(s.slots).toEqual([
      { rank: 1, host: 'adobe.com', domainRank: 842, pageRank: 0 },
      { rank: 2, host: 'ndesign-studio.com', domainRank: 545, pageRank: 0 },
    ]);
    expect(s.at).toBe('2025-10-16T10:32:29.000Z');
  });

  it('takes the NEWEST snapshot whatever the order', () => {
    const json = snapJson('2025-01-01 00:00:00 +00:00', [['old.com', 100]]);
    json.tasks[0].result[0].items.push(
      snapJson('2026-06-01 00:00:00 +00:00', [['new.com', 200]]).tasks[0].result[0].items[0],
    );
    expect(parseHistoricalSerp(json, NOW)!.slots[0].host).toBe('new.com');
  });

  it('refuses a snapshot too old to describe this year', () => {
    expect(parseHistoricalSerp(snapJson('2024-06-01 00:00:00 +00:00', [['a.com', 100]]), NOW)).toBeNull();
  });

  it('null on a failed task or no snapshots', () => {
    expect(parseHistoricalSerp({ tasks: [{ status_code: 40501 }] }, NOW)).toBeNull();
    expect(parseHistoricalSerp({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] }, NOW)).toBeNull();
  });
});

const snap = (ranks: (number | null)[], hosts?: string[]): SlotSnapshot => ({
  at: '2025-10-16T00:00:00Z',
  slots: ranks.map((dr, i) => ({ rank: i + 1, host: hosts?.[i] ?? `site${i}.com`, domainRank: dr, pageRank: 0 })),
});

describe('slotVerdict', () => {
  it('illustrator 3d logo: Adobe, YouTube, Adobe on top — dead, best seat #9', () => {
    const v = slotVerdict(snap([842, 1000, 842, 1000, 818, 1000, 609, 1000, 555, 545],
      ['adobe.com', 'youtube.com', 'adobe.com', 'youtube.com', 'reddit.com', 'youtube.com', 'iconscout.com', 'youtube.com', 'template.net', 'ndesign-studio.com']));
    expect(v.deadSpace).toBe(true);
    expect(v.firstOpen).toBe(7);
    expect(v.reason).toMatch(/adobe\.com/);
  });

  it('3d icon generator: small tool sites on top — open', () => {
    const v = slotVerdict(snap([284, 441, 604, 277, 636, 345, 586, 609, 694, 277]));
    expect(v.deadSpace).toBe(false);
    expect(v.firstOpen).toBe(1);
    expect(v.giants).toBe(1);
  });

  it('seven giants anywhere is dead even with an open top slot', () => {
    expect(slotVerdict(snap([300, 700, 700, 700, 700, 700, 700, 700, 300, 300])).deadSpace).toBe(true);
    expect(slotVerdict(snap([300, 700, 700, 700, 700, 700, 700, 300, 300, 300])).deadSpace).toBe(false);
  });

  it('a slot with no rank data can only look open, never condemn a SERP', () => {
    expect(slotVerdict(snap([900, 900, null, 900])).deadSpace).toBe(false);
  });

  it('the domain\'s own slot does not count against it', () => {
    const s = snap([900, 900, 900], ['youtube.com', 'adobe.com', 'blog.acme.com']);
    expect(slotVerdict(s).deadSpace).toBe(true);
    expect(slotVerdict(s, 'acme.com').deadSpace).toBe(false);
  });
});

describe('withSlotVerdict', () => {
  it('adds dead space but never removes it', () => {
    const open = groveDifficulty(20, serp(400));
    const dead = slotVerdict(snap([900, 900, 900]));
    expect(withSlotVerdict(open, dead).deadSpace).toBe(true);
    const averagedDead = groveDifficulty(0, serp(800));
    expect(withSlotVerdict(averagedDead, slotVerdict(snap([100, 100, 100]))).deadSpace).toBe(true);
  });
});
