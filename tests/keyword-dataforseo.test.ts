import { describe, it, expect } from 'vitest';
import {
  parseLabsItem, parseLabsResponse, dataforseoConfigured,
  describeLabsOutcome, summarizeLabsOutcomes,
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
    expect(parseLabsItem(item())).toEqual({
      keyword: 'blog automation tool',
      volume: 880,
      difficulty: 22,
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
