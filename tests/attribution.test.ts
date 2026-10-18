import { describe, it, expect } from 'vitest';
import {
  firstTouchFrom, encodeFirstTouch, decodeFirstTouch, shouldStampFirstTouch, readCookie,
  attributionMetadata, FIRST_TOUCH_COOKIE,
} from '../lib/attribution';

const NOW = new Date('2026-10-18T08:00:00.000Z');

describe('firstTouchFrom', () => {
  it('records the external referrer, utm tags and landing path', () => {
    const ft = firstTouchFrom({
      url: 'https://trygroveai.com/blog/some-post?utm_source=reddit&utm_medium=social&utm_campaign=beta&x=1',
      referrer: 'https://www.google.com/',
      appHost: 'trygroveai.com',
      now: NOW,
    })!;
    expect(ft).toEqual({
      landing_path: '/blog/some-post',
      first_seen_at: NOW.toISOString(),
      utm_source: 'reddit',
      utm_medium: 'social',
      utm_campaign: 'beta',
      referrer: 'https://www.google.com/',
      referrer_host: 'google.com',
    });
  });

  it('drops internal referrers, including the www twin', () => {
    for (const ref of ['https://trygroveai.com/', 'https://www.trygroveai.com/pricing']) {
      const ft = firstTouchFrom({ url: 'https://trygroveai.com/signup', referrer: ref, appHost: 'trygroveai.com', now: NOW })!;
      expect(ft.referrer).toBeUndefined();
      expect(ft.referrer_host).toBeUndefined();
    }
  });

  it('a direct visit is still recorded — landing path and time are the signal', () => {
    const ft = firstTouchFrom({ url: 'https://trygroveai.com/', referrer: null, now: NOW })!;
    expect(ft).toEqual({ landing_path: '/', first_seen_at: NOW.toISOString() });
  });

  it('ignores garbage and non-http referrers, and caps long values', () => {
    expect(firstTouchFrom({ url: 'https://trygroveai.com/', referrer: 'not a url', now: NOW })!.referrer).toBeUndefined();
    expect(firstTouchFrom({ url: 'https://trygroveai.com/', referrer: 'android-app://com.slack', now: NOW })!.referrer).toBeUndefined();
    const long = 'x'.repeat(1000);
    expect(firstTouchFrom({ url: `https://trygroveai.com/?utm_source=${long}`, now: NOW })!.utm_source!.length).toBe(200);
    expect(firstTouchFrom({ url: 'nope' })).toBeNull();
  });
});

describe('cookie round-trip', () => {
  const ft = firstTouchFrom({
    url: 'https://trygroveai.com/?utm_source=hn', referrer: 'https://news.ycombinator.com/item?id=1', now: NOW,
  })!;

  it('decodes both the server (decoded) and browser (percent-encoded) forms', () => {
    const value = encodeFirstTouch(ft);
    expect(decodeFirstTouch(value)).toEqual(ft); // cookies().get(...).value
    expect(decodeFirstTouch(encodeURIComponent(value))).toEqual(ft); // document.cookie
  });

  it('rejects anything that is not the expected shape', () => {
    expect(decodeFirstTouch(null)).toBeNull();
    expect(decodeFirstTouch('')).toBeNull();
    expect(decodeFirstTouch('%E0%A4%A')).toBeNull();
    expect(decodeFirstTouch('[1,2]')).toBeNull();
    expect(decodeFirstTouch(JSON.stringify({ landing_path: '/' }))).toBeNull();
    expect(decodeFirstTouch(JSON.stringify({ landing_path: '/', first_seen_at: 'never' }))).toBeNull();
  });

  it('drops unknown and non-string fields', () => {
    const raw = JSON.stringify({ landing_path: '/', first_seen_at: NOW.toISOString(), utm_source: 7, evil: 'x' });
    expect(decodeFirstTouch(raw)).toEqual({ landing_path: '/', first_seen_at: NOW.toISOString() });
  });

  it('reads the cookie out of a document.cookie string', () => {
    const header = `a=1; ${FIRST_TOUCH_COOKIE}=${encodeURIComponent(encodeFirstTouch(ft))}; b=2`;
    expect(decodeFirstTouch(readCookie(header, FIRST_TOUCH_COOKIE))).toEqual(ft);
    expect(readCookie('a=1', FIRST_TOUCH_COOKIE)).toBeNull();
    expect(readCookie('', FIRST_TOUCH_COOKIE)).toBeNull();
  });
});

describe('shouldStampFirstTouch', () => {
  const base = { method: 'GET', pathname: '/', hasCookie: false, isBot: false, isPrefetch: false };

  it('stamps a first page load on public pages, the blog included', () => {
    for (const pathname of ['/', '/ko', '/blog', '/blog/a-post', '/pricing', '/login', '/signup']) {
      expect(shouldStampFirstTouch({ ...base, pathname })).toBe(true);
    }
  });

  it('is first touch: never overwrites an existing cookie', () => {
    expect(shouldStampFirstTouch({ ...base, hasCookie: true })).toBe(false);
  });

  it('skips bots, prefetches and non-GET', () => {
    expect(shouldStampFirstTouch({ ...base, isBot: true })).toBe(false);
    expect(shouldStampFirstTouch({ ...base, isPrefetch: true })).toBe(false);
    expect(shouldStampFirstTouch({ ...base, method: 'POST' })).toBe(false);
  });

  it('skips APIs, auth, signed-in areas and files', () => {
    for (const pathname of [
      '/api/track', '/auth/callback', '/dashboard', '/onboarding/domain', '/oauth/authorize',
      '/.well-known/oauth-protected-resource', '/robots.txt', '/blog/sitemap.xml', '/blog/a-post/og',
    ]) {
      expect(shouldStampFirstTouch({ ...base, pathname }), pathname).toBe(false);
    }
  });
});

describe('attributionMetadata', () => {
  it('is empty without a record, so signUp gets no stray key', () => {
    expect(attributionMetadata(null)).toEqual({});
    const ft = { landing_path: '/', first_seen_at: NOW.toISOString() };
    expect(attributionMetadata(ft)).toEqual({ first_touch: ft });
  });
});
