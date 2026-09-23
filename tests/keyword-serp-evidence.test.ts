import { describe, it, expect } from 'vitest';
import {
  parseSerpAuthority, parseHistoricalSerp, slotVerdict, type SlotSnapshot,
} from '../lib/keywords/serp-evidence';

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
