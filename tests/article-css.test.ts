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

  it('applies its direct-child rules in the embed’s nested DOM too', () => {
    // The embed API wraps prose three levels deep —
    //   .grove-article > .grv-root > .grv-wrap > .grv-body > p
    // — to hang its floated TOC and CTA off the same tree, while grove's own
    // page drops the HTML straight in. A `>` rule written only for the flat
    // shape is inert in the embed, which is the context this file exists for.
    // Verified against a live oveners.com article: the lead paragraph was
    // rendering at 17px instead of 1.18em.
    for (const rule of ['> \\* \\+ \\*', '> p:first-of-type', '> p > em:only-child']) {
      const flat = new RegExp(`\\.${ARTICLE_CLASS} ${rule}`);
      const nested = new RegExp(`\\.${ARTICLE_CLASS} \\.grv-body ${rule}`);
      expect(ARTICLE_CSS, `flat form missing for "${rule}"`).toMatch(flat);
      expect(ARTICLE_CSS, `nested (.grv-body) form missing for "${rule}"`).toMatch(nested);
    }
  });

  it('caps the measure on the text column, not the two-column wrapper', () => {
    // The wrapper is the text column in only ONE of the two shapes. When the
    // article comes from the embed API the same wrapper also holds the 240px
    // TOC rail, so a cap there capped the whole grid: measured on a 1060px
    // shell, the rail kept its 240px and the body was squeezed to 444px —
    // narrower than it would have been with no sidebar at all.
    expect(ARTICLE_CSS).toMatch(
      new RegExp(`\\.${ARTICLE_CLASS}:has\\(\\.grv-root\\)\\s*\\{[^}]*max-width:\\s*none`),
    );
    expect(ARTICLE_CSS).toMatch(
      new RegExp(`\\.${ARTICLE_CLASS} \\.grv-body\\s*\\{[^}]*max-width:\\s*68ch`),
    );
  });

  it('restores list rendering that a reset strips', () => {
    // Tailwind preflight sets `ul,ol { list-style: none }` and `li { display:
    // block }`. Without putting these back, every bullet list in an article
    // renders as unmarked paragraphs.
    expect(ARTICLE_CSS).toMatch(/list-style: disc/);
    expect(ARTICLE_CSS).toMatch(/display: list-item/);
    // Ordered lists deliberately do NOT restore `decimal` — the badge treatment
    // draws the numeral through a counter, so the marker box stays off. That
    // makes ::before the only thing painting a number, which is why these two
    // assertions replace the `list-style: decimal` one that used to live here.
    expect(ARTICLE_CSS).toMatch(/counter-reset: gaol/);
    expect(ARTICLE_CSS).toMatch(/content: counter\(gaol\)/);
  });

  it('keeps the numbered badge on the accent token, never a fixed swatch', () => {
    // This file renders on domains grove does not control; a hardcoded green
    // badge would land as a grove-coloured chip in the middle of someone
    // else's palette. The rgba literals are the pre-color-mix fallback and
    // must always be paired with an --ga-accent declaration that overrides.
    const badge = ARTICLE_CSS.match(/ol > li::before \{[^}]*\}/)![0];
    expect(badge).toMatch(/color: var\(--ga-accent\)/);
    expect(badge).toMatch(/background: color-mix\(in srgb, var\(--ga-accent\)/);
    expect(badge).toMatch(/border-color: color-mix\(in srgb, var\(--ga-accent\)/);
  });
});

describe('parity with grove’s own .prose', () => {
  it.each(ELEMENTS)('globals.css styles %s too', (el) => {
    expect(globals).toMatch(new RegExp(`\\.prose ${el}[\\s,{:]`));
  });

  it('restores the bullet markers preflight strips, like ARTICLE_CSS does', () => {
    // The identical assertion has guarded ARTICLE_CSS since it shipped, and
    // globals.css never got one — so `menu, ol, ul { list-style: none }` won on
    // grove's own hosted article and EVERY list published at /b/[slug]
    // rendered unmarked. The ::marker colour rules sitting right underneath
    // were dead the whole time, styling a marker nothing drew.
    expect(globals).toMatch(/\.prose ul\s*\{[^}]*list-style: disc/);
  });

  it('draws numbered steps as badges on both surfaces, not bare numerals', () => {
    // `^` anchored so this cannot be satisfied by `.gv-app .prose ol`, which
    // has carried the editor's own badge treatment all along — the point is
    // that the PUBLISHED article now has one too.
    expect(globals).toMatch(/^\.prose ol \{[^}]*counter-reset: proseol/m);
    expect(globals).toMatch(/^\.prose ol > li::before \{[^}]*content: counter\(proseol\)/m);
    expect(ARTICLE_CSS).toMatch(/counter-reset: gaol/);
    // Both surfaces suppress the real marker, or the numeral would double up.
    expect(globals).toMatch(/^\.prose ol > li::marker \{ content: none/m);
    expect(ARTICLE_CSS).toMatch(/ol > li::marker \{ content: none/);
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
