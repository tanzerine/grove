/**
 * How the landing decides which language to serve.
 *
 * The rules matter more here than anywhere else in the i18n work, because
 * this is the only translated surface a SEARCH ENGINE sees. Get it wrong in
 * the obvious way — vary the language on Accept-Language at `/` — and the
 * Korean copy exists but is unfindable, since Googlebot crawls from US IPs
 * sending `en`. For a product that sells SEO that is not a small bug.
 *
 * So: a real URL per language, an hreflang pair that declares them, and
 * detection reduced to a single one-time nudge with four ways to say no.
 */
import { describe, it, expect } from 'vitest';
import {
  LANDING_LOCALES,
  LANDING_LOCALE_CODES,
  landingPath,
  landingAlternates,
  landingRedirect,
} from '../lib/landing-locale';
import { KO } from '../lib/i18n/ko';

const GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

describe('the landing exists at one URL per language', () => {
  it('serves English at / and Korean at /ko', () => {
    expect(landingPath('en')).toBe('/');
    expect(landingPath('ko')).toBe('/ko');
  });

  it('falls back to English for a language it is not translated into', () => {
    // es/zh are scaffolds in lib/i18n. A half-translated landing that gets
    // indexed is worse than an English one, so they have no URL here.
    expect(LANDING_LOCALE_CODES).toEqual(['en', 'ko']);
    expect(landingPath('es')).toBe('/');
    expect(landingPath(null)).toBe('/');
  });

  it('declares every translation plus an x-default in hreflang', () => {
    expect(landingAlternates()).toEqual({ en: '/', ko: '/ko', 'x-default': '/' });
  });

  it('offers each language under its own name, not the English one', () => {
    // A visitor who cannot read the page cannot read "Korean" either.
    expect(LANDING_LOCALES.find((l) => l.locale === 'ko')!.nativeName).toBe('한국어');
  });
});

describe('landingRedirect — the one job detection has here', () => {
  it('sends a first-time Korean visitor to the Korean landing', () => {
    expect(landingRedirect({
      path: '/', acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8', userAgent: CHROME,
    })).toBe('/ko');
  });

  it('NEVER redirects a crawler, whatever it asks for', () => {
    // The hreflang pair promises English at / and Korean at /ko. Redirecting
    // a crawler by its headers breaks that promise and is how a site ends up
    // with one language indexed at both URLs.
    expect(landingRedirect({
      path: '/', acceptLanguage: 'ko-KR,ko;q=0.9', userAgent: GOOGLEBOT,
    })).toBe(null);
  });

  it('never overrides a stated preference', () => {
    // gv_lang is written by the nav switcher and by Brand voice. Someone who
    // picked English gets English, in a Korean browser, every time.
    expect(landingRedirect({
      path: '/', cookieLocale: 'en', acceptLanguage: 'ko-KR,ko;q=0.9', userAgent: CHROME,
    })).toBe(null);
  });

  it('only acts on the English landing itself', () => {
    for (const path of ['/ko', '/blog', '/signup', '/dashboard', '/privacy']) {
      expect(landingRedirect({ path, acceptLanguage: 'ko-KR', userAgent: CHROME }), path).toBe(null);
    }
  });

  it('leaves an English or unsupported-language visitor alone', () => {
    expect(landingRedirect({ path: '/', acceptLanguage: 'en-US,en;q=0.9', userAgent: CHROME })).toBe(null);
    // French is a supported UI locale's neighbour but not a landing language;
    // Spanish IS a UI locale and still has no landing, which is the case that
    // would break if this read the four UI codes instead of the two here.
    expect(landingRedirect({ path: '/', acceptLanguage: 'fr-FR,fr;q=0.9', userAgent: CHROME })).toBe(null);
    expect(landingRedirect({ path: '/', acceptLanguage: 'es-ES,es;q=0.9', userAgent: CHROME })).toBe(null);
    expect(landingRedirect({ path: '/', acceptLanguage: null, userAgent: CHROME })).toBe(null);
  });

  it('honours q-weights rather than header order', () => {
    expect(landingRedirect({
      path: '/', acceptLanguage: 'ko;q=0.3,en;q=0.9', userAgent: CHROME,
    })).toBe(null);
    expect(landingRedirect({
      path: '/', acceptLanguage: 'en;q=0.3,ko;q=0.9', userAgent: CHROME,
    })).toBe('/ko');
  });

  it('is idempotent — the redirect target never redirects again', () => {
    const first = landingRedirect({ path: '/', acceptLanguage: 'ko', userAgent: CHROME })!;
    expect(landingRedirect({ path: first, acceptLanguage: 'ko', userAgent: CHROME })).toBe(null);
  });
});

describe('the Korean landing is actually translated', () => {
  it('has the two strings a searcher reads before the page', () => {
    // Title and description are the highest-value strings on the marketing
    // site, and the ones most easily left English by translating only what
    // renders in the body.
    const title = 'grove — AI agent that writes & auto-publishes SEO blog posts';
    expect(KO[title]).toBeTruthy();
    expect(KO[title]).not.toBe(title);
    expect(Object.keys(KO).some((k) => k.startsWith('grove is an AI marketing agent'))).toBe(true);
  });
});
