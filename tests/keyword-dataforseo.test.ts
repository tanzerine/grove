import { describe, it, expect } from 'vitest';
import {
  parseLabsItem, parseLabsResponse, dataforseoConfigured,
  describeLabsOutcome, summarizeLabsOutcomes, credentialShapeWarning, mergeAuthority,
} from '../lib/keywords/dataforseo';

// Shaped from the documented Labs response. The parsing is tested rather than
// the transport, because grove's sandboxes block dataforseo.com and a wrong
// FIELD is the failure that would survive a successful HTTP call.
const item = (over: Record<string, any> = {}) => ({
  keyword: 'blog automation tool',
  keyword_info: { search_volume: 880, cpc: 3.4, competition: 0.33 },
  keyword_properties: { keyword_difficulty: 22 },
  search_intent_info: { main_intent: 'commercial' },
  ...over,
});

describe('parseLabsItem', () => {
  it('reads volume, difficulty and intent from their real paths', () => {
    expect(parseLabsItem(item())).toMatchObject({
      keyword: 'blog automation tool',
      volume: 880,
      difficulty: 22,
      providerKd: 22,
      serp: null,
      intent: 'commercial',
      source: 'dataforseo',
    });
  });

  it('does NOT mistake paid competition (0-1) for organic difficulty (0-100)', () => {
    // The failure this guards: competition 0.33 read as difficulty would pass
    // every keyword through a KD<=30 gate, on a scale off by 100x, silently.
    const parsed = parseLabsItem(item({ keyword_properties: {} }));
    expect(parsed!.difficulty).toBeNull();
    expect(parsed!.difficulty).not.toBe(0.33);
  });

  it('treats an out-of-range difficulty as unknown rather than screening on it', () => {
    expect(parseLabsItem(item({ keyword_properties: { keyword_difficulty: 900 } }))!.difficulty).toBeNull();
    expect(parseLabsItem(item({ keyword_properties: { keyword_difficulty: -5 } }))!.difficulty).toBeNull();
  });

  it('keeps a real zero volume distinct from a missing one', () => {
    expect(parseLabsItem(item({ keyword_info: { search_volume: 0 } }))!.volume).toBe(0);
    expect(parseLabsItem(item({ keyword_info: {} }))!.volume).toBeNull();
    expect(parseLabsItem(item({ keyword_info: { search_volume: null } }))!.volume).toBeNull();
  });

  it('rejects an unknown intent label instead of passing it through', () => {
    expect(parseLabsItem(item({ search_intent_info: { main_intent: 'shopping' } }))!.intent).toBeNull();
    expect(parseLabsItem(item({ search_intent_info: null }))!.intent).toBeNull();
  });

  it('drops items with no keyword', () => {
    expect(parseLabsItem(item({ keyword: '   ' }))).toBeNull();
    expect(parseLabsItem({})).toBeNull();
  });

  it('parses a Korean row', () => {
    const p = parseLabsItem(item({ keyword: '블로그 자동화 도구' }));
    expect(p!.keyword).toBe('블로그 자동화 도구');
    expect(p!.volume).toBe(880);
  });
});

describe('parseLabsResponse', () => {
  it('returns the items of a successful task', () => {
    const out = parseLabsResponse({ tasks: [{ status_code: 20000, result: [{ items: [item(), item({ keyword: 'x' })] }] }] });
    expect(out).toHaveLength(2);
  });

  it('returns NULL for a failed task that arrived with HTTP 200', () => {
    // DataForSEO reports per-task errors in the body. Reading res.ok alone
    // would turn a failed task into "no demand", which is the exact confusion
    // seeds.ts spent months on.
    expect(parseLabsResponse({ tasks: [{ status_code: 40501, status_message: 'nope' }] })).toBeNull();
  });

  it('distinguishes "asked, nothing there" from "never asked"', () => {
    expect(parseLabsResponse({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] })).toEqual([]);
    expect(parseLabsResponse({})).toBeNull();
    expect(parseLabsResponse({ tasks: [] })).toBeNull();
  });
});

describe('dataforseoConfigured', () => {
  it('is false without both credentials', () => {
    const l = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD;
    delete process.env.DATAFORSEO_LOGIN; delete process.env.DATAFORSEO_PASSWORD;
    expect(dataforseoConfigured()).toBe(false);
    process.env.DATAFORSEO_LOGIN = 'x';
    expect(dataforseoConfigured()).toBe(false);
    process.env.DATAFORSEO_PASSWORD = 'y';
    expect(dataforseoConfigured()).toBe(true);
    if (l === undefined) delete process.env.DATAFORSEO_LOGIN; else process.env.DATAFORSEO_LOGIN = l;
    if (p === undefined) delete process.env.DATAFORSEO_PASSWORD; else process.env.DATAFORSEO_PASSWORD = p;
  });
});

describe('describeLabsOutcome', () => {
  it('names the remedy for a missing configuration, not just the symptom', () => {
    const msg = describeLabsOutcome({ ok: false, reason: 'not_configured', detail: 'missing DATAFORSEO_LOGIN' });
    expect(msg).toMatch(/not set/i);
    expect(msg).toMatch(/Production/);        // the Vercel checkbox that bit us
    expect(msg).toMatch(/deploy/);            // vars only apply to later deploys
  });

  it('tells a 401 apart from a 403 — different credentials vs whitelist remedies', () => {
    const msg = describeLabsOutcome({ ok: false, reason: 'http', detail: 'HTTP 401' });
    expect(msg).toContain('401');
    expect(msg).toMatch(/API password/);      // not the dashboard sign-in password
    expect(msg).toMatch(/IP whitelist/);
  });

  it('reports a task failure that arrived inside a 200', () => {
    const msg = describeLabsOutcome({ ok: false, reason: 'task', detail: '40501 invalid field' });
    expect(msg).toContain('40501');
    expect(msg).toMatch(/out of funds|malformed/);
  });

  it('reports an unreachable host distinctly from a rejected one', () => {
    expect(describeLabsOutcome({ ok: false, reason: 'network', detail: 'fetch failed' }))
      .toMatch(/could not reach/);
  });

  it('says ok when it worked', () => {
    expect(describeLabsOutcome({ ok: true, json: {} })).toBe('ok');
  });
});

describe('summarizeLabsOutcomes', () => {
  it('collapses a wholly successful batch', () => {
    expect(summarizeLabsOutcomes([{ ok: true, json: {} }, { ok: true, json: {} }])).toBe('ok (2/2)');
  });

  it('reports the first failure in full rather than thirty truncated ones', () => {
    const out = summarizeLabsOutcomes([
      { ok: true, json: {} },
      { ok: false, reason: 'http', detail: 'HTTP 401' },
      { ok: false, reason: 'http', detail: 'HTTP 401' },
    ]);
    expect(out).toContain('1/3 succeeded');
    expect(out).toContain('401');
  });

  it('distinguishes "no calls made" from "every call failed"', () => {
    // The whole point of the type: absence and refusal are different events.
    expect(summarizeLabsOutcomes([])).toBe('no calls made');
    expect(summarizeLabsOutcomes([{ ok: false, reason: 'not_configured', detail: '' }]))
      .toMatch(/0\/1 succeeded/);
  });
});

describe('credentialShapeWarning', () => {
  const LOGIN = 'someone@example.com';
  const token = (l: string, p: string) => Buffer.from(`${l}:${p}`).toString('base64');

  it('catches the pre-encoded Authorization token pasted as the password', () => {
    // The failure that cost grove its first live run: the dashboard shows the
    // raw credentials next to a ready-made Basic token, and the token looks
    // exactly like a long opaque password.
    const msg = credentialShapeWarning(LOGIN, token(LOGIN, '9ed7dafe2ed000a5'));
    expect(msg).toMatch(/TOKEN/);
    expect(msg).toMatch(/double-encode/);
  });

  it('is case-insensitive on the login, as email is', () => {
    expect(credentialShapeWarning('SomeOne@Example.com', token(LOGIN, 'pw123456'))).not.toBeNull();
  });

  it('does NOT fire on an ordinary password that happens to look like base64', () => {
    // Narrow on purpose: it must decode to THIS login, or it stays quiet.
    expect(credentialShapeWarning(LOGIN, 'aGVsbG93b3JsZGhlbGxv')).toBeNull();
    expect(credentialShapeWarning(LOGIN, token('other@example.com', 'pw123456'))).toBeNull();
  });

  it('stays quiet on short, non-base64 or missing values', () => {
    expect(credentialShapeWarning(LOGIN, '9ed7dafe2ed000a5')).toBeNull();   // the correct shape
    expect(credentialShapeWarning(LOGIN, 'short')).toBeNull();
    expect(credentialShapeWarning(LOGIN, 'has spaces and !!')).toBeNull();
    expect(credentialShapeWarning('', 'anything')).toBeNull();
    expect(credentialShapeWarning(LOGIN, '')).toBeNull();
  });
});

describe('describeLabsOutcome — the API\'s own words win', () => {
  it('passes DataForSEO\'s status_message through without adding a contradicting guess', () => {
    // 40104 arrives as a 403. Our generic advice blames an IP whitelist, which
    // is wrong and would send someone to the firewall instead of the account
    // verification page.
    const msg = describeLabsOutcome({
      ok: false, reason: 'http',
      detail: 'HTTP 403 — 40104 Please verify your account before using the API.',
    });
    expect(msg).toContain('40104');
    expect(msg).toContain('verify your account');
    expect(msg).not.toMatch(/IP whitelist/);
  });

  it('still offers the generic advice when the body said nothing useful', () => {
    const msg = describeLabsOutcome({ ok: false, reason: 'http', detail: 'HTTP 502' });
    expect(msg).toMatch(/IP whitelist|API password/);
  });
});

// Recorded from the live API, 2026-09-23 (keyword_overview, include_serp_info).
// The KD-0 trap as it actually arrives: no page links, giant domains.
const trap = item({
  keyword: 'illustrator 3d logo',
  keyword_info: { search_volume: 30 },
  keyword_properties: { keyword_difficulty: 0 },
  avg_backlinks_info: {
    se_type: 'google', backlinks: 4, dofollow: 3.5, referring_pages: 3.6, referring_domains: 0.7,
    referring_main_domains: 0.6, rank: 13.5, main_domain_rank: 841.8,
  },
  serp_info: { serp_item_types: ['images', 'people_also_ask', 'organic', 'related_searches'] },
});

describe('parseLabsItem — grove difficulty from the raw fields', () => {
  it('reads the top 10\'s domain authority that KD ignores', () => {
    const k = parseLabsItem(trap)!;
    expect(k.providerKd).toBe(0);
    expect(k.serp?.domainRank).toBeCloseTo(841.8);
    expect(k.difficulty).toBe(100);
    expect(k.assessment?.deadSpace).toBe(true);
  });

  it('keeps the provider KD when the SERP is held by small sites', () => {
    const k = parseLabsItem(item({
      keyword: '3d icon generator',
      keyword_properties: { keyword_difficulty: 21 },
      avg_backlinks_info: { referring_main_domains: 10.4, rank: 118.4, main_domain_rank: 426.5 },
      serp_info: { serp_item_types: ['organic', 'video', 'related_searches', 'images'] },
    }))!;
    expect(k.difficulty).toBe(21);
    expect(k.assessment?.deadSpace).toBe(false);
  });

  it('distrusts a low KD that arrives with no authority data', () => {
    const k = parseLabsItem(item({ keyword_properties: { keyword_difficulty: 0 } }))!;
    expect(k.providerKd).toBe(0);
    expect(k.difficulty).toBeNull();
    expect(k.assessment?.basis).toBe('kd_only');
  });
});


describe('mergeAuthority — re-measuring the ledger', () => {
  const ledgerRow = { keyword: 'pixel 3d icon pack', volume: 4400, difficulty: null, providerKd: 0, intent: null, source: 'dataforseo' } as const;

  it('replaces a stored KD 0 with the fresh assessment, keeping source and revealed demand', () => {
    const fresh = parseLabsItem(item({
      keyword: 'pixel 3d icon pack',
      keyword_properties: { keyword_difficulty: 0 },
      avg_backlinks_info: { referring_main_domains: 0.1, rank: 7.8, main_domain_rank: 599.2 },
    }))!;
    const rev = { impressions: 12, clicks: 0, position: 40, days: 28 };
    const [out] = mergeAuthority([{ ...ledgerRow, source: 'gsc', revealed: rev }], [fresh]);
    expect(out.source).toBe('gsc');
    expect(out.revealed).toEqual(rev);
    expect(out.difficulty).toBeGreaterThan(45);
    expect(out.serp?.domainRank).toBeCloseTo(599.2);
  });

  it('marks a keyword the overview did not return as asked, so it is not asked twice', () => {
    const [out] = mergeAuthority([{ ...ledgerRow }], []);
    expect(out.serp).toBeNull();
  });

  it('leaves a keyword already measured this run alone', () => {
    const measured = { ...ledgerRow, serp: null };
    expect(mergeAuthority([measured], [])[0]).toBe(measured);
  });
});
