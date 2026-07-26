/**
 * The typography grove ships to customer sites must stay in step with the
 * typography grove uses on its own blog.
 *
 * These are two files by necessity — globals.css is a static stylesheet built
 * around grove's design tokens, ARTICLE_CSS is self-contained so it survives on
 * a host we don't control. That's exactly the setup where a rule gets added to
 * one and forgotten in the other, which is how customers ended up rebuilding
 * grove's article styles by hand in the first place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ARTICLE_CSS, ARTICLE_CLASS } from '../lib/blog/article-css';

const globals = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

/** Every element the article body can contain, and must therefore style. */
const ELEMENTS = ['h1', 'h2', 'h3', 'h4', 'p', 'a', 'strong', 'em', 'ul', 'ol', 'blockquote', 'code', 'pre', 'hr', 'img', 'table'];

describe('ARTICLE_CSS covers the article body', () => {
  it.each(ELEMENTS)('styles %s', (el) => {
    expect(ARTICLE_CSS).toMatch(new RegExp(`\\.${ARTICLE_CLASS} ${el}[\\s,{:]`));
  });

  it('keeps the editorial details, not just the basics', () => {
    // Each of these is something ovenai's hand-rolled fork was missing — the
    // difference between "styled" and "looks like grove wrote it".
    expect(ARTICLE_CSS).toContain('max-width: 68ch');          // measure cap
    expect(ARTICLE_CSS).toMatch(/> p:first-of-type/);          // lead paragraph
    expect(ARTICLE_CSS).toMatch(/li::marker/);                 // colored markers
    expect(ARTICLE_CSS).toMatch(/h2::before/);                 // heading rule
    expect(ARTICLE_CSS).toMatch(/img \+ em/);                  // image captions
  });

  it('is self-contained: every color resolves without grove’s tokens', () => {
    // A bare var(--ink) would silently render as `inherit` on a customer's
    // site, which is how "styled" turns into "unstyled" in production.
    const groveTokens = ARTICLE_CSS.match(/var\(--(?:ink|moss|clay|line|paper|bone)\b[^)]*\)/g);
    expect(groveTokens).toBeNull();

    // Local custom properties are fine; each must carry a literal fallback or
    // be declared on the wrapper itself.
    for (const m of ARTICLE_CSS.matchAll(/var\((--ga-[a-z-]+)\)/g)) {
      expect(ARTICLE_CSS).toMatch(new RegExp(`${m[1]}:`));
    }
  });

  it('outranks a host site’s CSS reset on every element rule', () => {
    // `.grove-article h2` is (0,1,1) and beats a reset's bare `h2` (0,0,1) in
    // any load order. A bare element selector here would lose that fight — and
    // losing it is the entire bug this file exists to fix.
    const bareElementRule = new RegExp(`^\\s*(${ELEMENTS.join('|')})\\s*\\{`, 'm');
    expect(ARTICLE_CSS).not.toMatch(bareElementRule);
  });

  it('restores list rendering that a reset strips', () => {
    // Tailwind preflight sets `ul,ol { list-style: none }` and `li { display:
    // block }`. Without putting these back, every bullet list in an article
    // renders as unmarked paragraphs.
    expect(ARTICLE_CSS).toMatch(/list-style: disc/);
    expect(ARTICLE_CSS).toMatch(/list-style: decimal/);
    expect(ARTICLE_CSS).toMatch(/display: list-item/);
  });
});

describe('parity with grove’s own .prose', () => {
  it.each(ELEMENTS)('globals.css styles %s too', (el) => {
    expect(globals).toMatch(new RegExp(`\\.prose ${el}[\\s,{:]`));
  });

  it('shares the reader-facing measurements that define the look', () => {
    // If grove retunes its own article and forgets the hosted copy, customers
    // silently drift back to looking different. These are the values a reader
    // would actually notice.
    for (const value of ['68ch', '1.78', '17px']) {
      expect(globals).toContain(value);
      expect(ARTICLE_CSS).toContain(value);
    }
  });
});
