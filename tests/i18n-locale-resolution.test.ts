import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Where the UI language comes from.
 *
 * The bug this locks down: an owner set one site to English, switched to it,
 * and the dashboard stayed Korean. UI language was a property of the PERSON
 * (auth metadata + a switcher in the account menu) while publication language
 * was a property of the SITE, so the two could disagree and the person-level
 * one silently won. There is one control now — the picker on Brand voice —
 * and the resolver reads the ACTIVE SITE first.
 */

const state = {
  domain: null as null | { id: string; verified_at: string | null; language?: string | null },
  cookies: {} as Record<string, string>,
  acceptLanguage: null as string | null,
  domainThrows: false,
};

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (k: string) => (state.cookies[k] ? { value: state.cookies[k] } : undefined) }),
  headers: async () => ({ get: (k: string) => (k === 'accept-language' ? state.acceptLanguage : null) }),
}));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  // `cache()` memoises per request; these tests want each call resolved fresh.
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock('../lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));
vi.mock('../lib/active-domain', () => ({
  getActiveDomainFields: async () => {
    if (state.domainThrows) throw new Error('db down');
    return state.domain;
  },
}));

const { getUiLocale, getPublicUiLocale, localeForDomain, localeFromAcceptLanguage } =
  await import('../lib/i18n/server');
const { UI_LANG_COOKIE } = await import('../lib/i18n');

beforeEach(() => {
  state.domain = null;
  state.cookies = {};
  state.acceptLanguage = null;
  state.domainThrows = false;
});

describe('the UI language follows the active site', () => {
  it('uses the active site\'s language', async () => {
    state.domain = { id: 'd1', verified_at: null, language: 'ko' };
    expect(await getUiLocale()).toBe('ko');
  });

  it('switching sites switches the language', async () => {
    state.domain = { id: 'ko-site', verified_at: null, language: 'ko' };
    expect(await getUiLocale()).toBe('ko');
    // The site switcher writes a cookie and reloads; every RSC re-resolves.
    state.domain = { id: 'en-site', verified_at: null, language: 'en' };
    expect(await getUiLocale()).toBe('en');
  });

  it('the site beats a stale gv_lang cookie — the exact reported bug', async () => {
    state.cookies[UI_LANG_COOKIE] = 'ko';                       // set on an older site
    state.domain = { id: 'd2', verified_at: null, language: 'en' };
    expect(await getUiLocale()).toBe('en');
  });
});

describe('falling back when there is no site', () => {
  it('uses the last saved choice', async () => {
    state.cookies[UI_LANG_COOKIE] = 'es';
    expect(await getUiLocale()).toBe('es');
  });

  it('then the browser\'s own preference', async () => {
    state.acceptLanguage = 'ko-KR,ko;q=0.9,en;q=0.8';
    expect(await getUiLocale()).toBe('ko');
  });

  it('then English', async () => {
    expect(await getUiLocale()).toBe('en');
  });

  it('ignores a language the product does not support', async () => {
    state.domain = { id: 'd3', verified_at: null, language: 'fr' };
    state.cookies[UI_LANG_COOKIE] = 'de';
    state.acceptLanguage = 'fr-FR';
    expect(await getUiLocale()).toBe('en');
  });

  it('survives the domain lookup failing — a label must never 500 a page', async () => {
    state.domainThrows = true;
    state.cookies[UI_LANG_COOKIE] = 'ko';
    expect(await getUiLocale()).toBe('ko');
  });

  it('reads a site whose row predates the language column as English', async () => {
    state.domain = { id: 'd4', verified_at: null };
    expect(await getUiLocale()).toBe('en');
  });
});

describe('getPublicUiLocale — auth and onboarding, before the dashboard', () => {
  it('detects a first-time Korean visitor from the browser alone', async () => {
    // The whole point of the funnel work: nobody hunts for a switcher to read
    // the sign-up page they just landed on.
    state.acceptLanguage = 'ko-KR,ko;q=0.9,en;q=0.8';
    expect(await getPublicUiLocale()).toBe('ko');
  });

  it('prefers the language the owner actually chose', async () => {
    state.cookies[UI_LANG_COOKIE] = 'ko';
    state.acceptLanguage = 'en-US,en;q=0.9';
    expect(await getPublicUiLocale()).toBe('ko');
  });

  it('does NOT follow the active site — the bug this function exists to avoid', async () => {
    // A Korean-speaking owner adding a second site that publishes in English.
    // getUiLocale is right to read the site inside the dashboard; onboarding
    // must not switch language underneath them while they configure it.
    state.cookies[UI_LANG_COOKIE] = 'ko';
    state.domain = { id: 'en-site', verified_at: null, language: 'en' };
    expect(await getPublicUiLocale()).toBe('ko');
    expect(await getUiLocale()).toBe('en');       // the dashboard still follows the site
  });

  it('falls back to English with nothing to go on', async () => {
    expect(await getPublicUiLocale()).toBe('en');
  });

  it('ignores an unsupported language in either source', async () => {
    state.cookies[UI_LANG_COOKIE] = 'de';
    state.acceptLanguage = 'fr-FR';
    expect(await getPublicUiLocale()).toBe('en');
  });
});

describe('localeForDomain — for routes that already know the site', () => {
  it('reads the row directly, with no cookie involved', () => {
    expect(localeForDomain({ language: 'ko' })).toBe('ko');
    expect(localeForDomain({ language: null })).toBe('en');
    expect(localeForDomain(null)).toBe('en');
    expect(localeForDomain({ language: 'nonsense' })).toBe('en');
  });
});

describe('localeFromAcceptLanguage', () => {
  it('picks the highest-q supported language', () => {
    expect(localeFromAcceptLanguage('ko-KR,ko;q=0.9,en;q=0.8')).toBe('ko');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.5')).toBe('es');
  });

  it('returns null when nothing is supported', () => {
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBe(null);
    expect(localeFromAcceptLanguage(null)).toBe(null);
  });
});
