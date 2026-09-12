/**
 * How the landing decides which language to serve.
 *
 * The rules matter more here than anywhere else in the i18n work, because
 * this is the only translated surface a SEARCH ENGINE sees. Get it wrong in
 * the obvious way — vary the language on Accept-Language at `/` — and the
 * Korean copy exists but is unfindable, since Googlebot crawls from US IPs
 * sending `en`. For a product that sells SEO that is not a small bug.
 *
 * So: a real URL per language, an hreflang pair that declares them, and no
 * detection at all — `/` is English for everyone until they pick otherwise.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as landing from '../lib/landing-locale';
import { KO } from '../lib/i18n/ko';

const { LANDING_LOCALES, LANDING_LOCALE_CODES, landingPath, landingAlternates } = landing;

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

describe('the landing never detects a language', () => {
  it('exports no redirect — / is English for every first-time visitor', () => {
    // An earlier version 307'd a Korean browser from / to /ko once, until
    // gv_lang was set. The product default is now English on every page until
    // the visitor chooses, so nothing in this module (or middleware, which
    // used to call it) reads Accept-Language. If a redirect comes back it
    // needs to be a deliberate decision, not a leftover.
    expect('landingRedirect' in landing).toBe(false);
  });

  it('nothing that picks a UI language reads Accept-Language', () => {
    // The three files that resolve or route on language. A header read in any
    // of them is the old behaviour coming back.
    for (const file of ['middleware.ts', 'lib/i18n/server.ts', 'lib/landing-locale.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      // Prose may mention the header when explaining why it is NOT read;
      // code reads it through a string literal or a `headers()` call.
      const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(code, file).not.toMatch(/accept-language/i);
      expect(code, file).not.toMatch(/\bheaders\(\)/);
    }
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
