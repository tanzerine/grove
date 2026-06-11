import { describe, it, expect } from 'vitest';
import { escapeXml, isBot, jsonLdScript, appBase } from '../lib/seo';

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });
  it('passes plain text through unchanged', () => {
    expect(escapeXml('hello world 한국어 123')).toBe('hello world 한국어 123');
  });
});

describe('isBot', () => {
  it('flags common crawlers and preview fetchers', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBot('facebookexternalhit/1.1')).toBe(true);
    expect(isBot('curl/8.4.0')).toBe(true);
    expect(isBot('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe(true);
    expect(isBot('GPTBot/1.0')).toBe(true);
  });
  it('passes real browsers', () => {
    expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')).toBe(false);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe(false);
  });
  it('treats missing UA as not-bot', () => {
    expect(isBot(null)).toBe(false);
    expect(isBot(undefined)).toBe(false);
    expect(isBot('')).toBe(false);
  });
});

describe('jsonLdScript', () => {
  it('escapes < so titles cannot break out of the script tag', () => {
    const out = jsonLdScript({ headline: 'x</script><script>alert(1)' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out.replace(/\\u003c/g, '<'))).toEqual({ headline: 'x</script><script>alert(1)' });
  });
});

describe('appBase', () => {
  it('returns an origin without a trailing slash', () => {
    expect(appBase().endsWith('/')).toBe(false);
    expect(appBase()).toMatch(/^https?:\/\//);
  });
});
