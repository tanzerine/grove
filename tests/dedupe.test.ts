import { describe, it, expect } from 'vitest';
import {
  normalizeTopic,
  dedupeKeyFor,
  dedupeKeyCandidates,
  isDedupeCollision,
  isMissingColumn,
  DEDUPE_WINDOW_MS,
} from '../lib/dedupe';

const USER = '452dd887-9049-4298-a7c3-d1a28ad8a98b';
const DOMAIN = '9f1c2a44-0000-4000-8000-00000000abcd';
const at = (ms: number) => new Date(ms);

describe('normalizeTopic', () => {
  it('collapses the cosmetic differences between one intent typed twice', () => {
    expect(normalizeTopic('  Best CRM   for Startups ')).toBe('best crm for startups');
  });

  it('normalises unicode so pasted and typed text agree', () => {
    // NFKC — the compatibility forms a rich-text editor leaves behind.
    expect(normalizeTopic('ﬁnance')).toBe(normalizeTopic('finance'));
  });

  it('handles CJK topics, which this product publishes routinely', () => {
    expect(normalizeTopic('  스타트업  마케팅 ')).toBe('스타트업 마케팅');
  });
});

describe('dedupeKeyFor', () => {
  it('gives one intent one key regardless of spelling', () => {
    const a = dedupeKeyFor({ userId: USER, domainId: DOMAIN, topic: 'Best CRM', at: at(0) });
    const b = dedupeKeyFor({ userId: USER, domainId: DOMAIN, topic: '  best   crm ', at: at(500) });
    expect(a).toBe(b);
  });

  it('separates different users, domains and topics', () => {
    const base = { userId: USER, domainId: DOMAIN, topic: 'crm', at: at(0) };
    const k = dedupeKeyFor(base);
    expect(dedupeKeyFor({ ...base, userId: 'other' })).not.toBe(k);
    expect(dedupeKeyFor({ ...base, domainId: 'other' })).not.toBe(k);
    expect(dedupeKeyFor({ ...base, topic: 'seo' })).not.toBe(k);
  });

  it('cannot be confused by field boundaries', () => {
    // ('ab','c') and ('a','bc') must not hash alike — the reason the material
    // is joined with a separator that cannot occur inside a normalised topic.
    const x = dedupeKeyFor({ userId: 'ab', domainId: 'c', topic: 't', at: at(0) });
    const y = dedupeKeyFor({ userId: 'a', domainId: 'bc', topic: 't', at: at(0) });
    expect(x).not.toBe(y);
  });

  it('lets the same topic through again in a later window', () => {
    const base = { userId: USER, domainId: DOMAIN, topic: 'crm' };
    const now = dedupeKeyFor({ ...base, at: at(0) });
    const later = dedupeKeyFor({ ...base, at: at(DEDUPE_WINDOW_MS * 5) });
    expect(later).not.toBe(now);
  });

  it('is opaque and fixed-width — it lands in a database column', () => {
    const k = dedupeKeyFor({ userId: USER, domainId: DOMAIN, topic: 'secret product launch', at: at(0) });
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).not.toContain('secret');
  });
});

describe('dedupeKeyCandidates', () => {
  it('offers the current key first, so the common case matches immediately', () => {
    const input = { userId: USER, domainId: DOMAIN, topic: 'crm', at: at(DEDUPE_WINDOW_MS + 10) };
    expect(dedupeKeyCandidates(input)[0]).toBe(dedupeKeyFor(input));
  });

  it('closes the bucket seam: two clicks 200ms apart across an edge still collide', () => {
    // This is the whole reason the previous bucket is consulted. Without it the
    // bug is rare enough to survive testing and certain to happen in production.
    const justBefore = DEDUPE_WINDOW_MS - 100;
    const justAfter = DEDUPE_WINDOW_MS + 100;
    const first = dedupeKeyFor({ userId: USER, domainId: DOMAIN, topic: 'crm', at: at(justBefore) });
    const second = dedupeKeyCandidates({ userId: USER, domainId: DOMAIN, topic: 'crm', at: at(justAfter) });
    expect(second).toContain(first);
  });

  it('does not reach back further than one window', () => {
    const old = dedupeKeyFor({ userId: USER, domainId: DOMAIN, topic: 'crm', at: at(0) });
    const now = dedupeKeyCandidates({
      userId: USER, domainId: DOMAIN, topic: 'crm', at: at(DEDUPE_WINDOW_MS * 3),
    });
    expect(now).not.toContain(old);
  });

  it('returns exactly two distinct candidates', () => {
    const c = dedupeKeyCandidates({ userId: USER, domainId: DOMAIN, topic: 'crm', at: at(0) });
    expect(c).toHaveLength(2);
    expect(new Set(c).size).toBe(2);
  });
});

describe('isDedupeCollision', () => {
  it('recognises unique_violation as a lost race, not a failure', () => {
    expect(isDedupeCollision({ code: '23505' })).toBe(true);
  });

  it('leaves every other error to surface as an error', () => {
    // Misreading a real insert failure as a collision would show the customer a
    // success for a draft that does not exist.
    for (const e of [{ code: '23503' }, { code: '42P01' }, {}, null, undefined]) {
      expect(isDedupeCollision(e), JSON.stringify(e)).toBe(false);
    }
  });
});

describe('isMissingColumn', () => {
  it('recognises undefined_column, so a lagging migration degrades instead of failing', () => {
    expect(isMissingColumn({ code: '42703' })).toBe(true);
  });

  it('is not confused with a dedupe collision — the two demand opposite responses', () => {
    // 23505 means "return the winner's id"; 42703 means "retry without the key".
    expect(isMissingColumn({ code: '23505' })).toBe(false);
    expect(isDedupeCollision({ code: '42703' })).toBe(false);
  });

  it('leaves every other error alone', () => {
    for (const e of [{ code: '42P01' }, {}, null, undefined]) {
      expect(isMissingColumn(e), JSON.stringify(e)).toBe(false);
    }
  });
});
