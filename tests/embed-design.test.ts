/**
 * Design inheritance — the embed reading the page it's mounted in.
 *
 * The bug this covers: the embed shipped grove's own design system into every
 * customer page. White cards, #1a2e1f green body text, #f5f3ed blockquote fills
 * and `ui-monospace` on every label, dropped onto sites that had chosen none of
 * those. On a sand-colored, serif, plum-inked page the blog section read as a
 * different product embedded in the middle of theirs.
 *
 * embed.js has no DOM harness (the suite is `environment: 'node'`), so the
 * derivation is written as pure functions over plain values and tested here
 * directly; only the thin measurement layer touches the DOM. The stylesheet
 * contract at the bottom is the part that actually rots — a literal color or a
 * hardcoded font in one new rule is invisible in review and undoes the whole
 * feature for that element.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(path.join(process.cwd(), 'public/embed.js'), 'utf8');

/**
 * Pull the color/derivation helpers out of the IIFE and make them callable.
 * They're mutually recursive (deriveTokens → mix/luminance/readableOn), so the
 * whole set is evaluated together in one scope rather than one at a time.
 */
function load(): Record<string, any> {
  const names = [
    'parseColor', 'rgbStr', 'mix', 'luminance', 'contrast', 'readableOn', 'cardSurface',
    'chroma', 'nearColor', 'isAccentCandidate', 'deriveTokens',
  ];
  const bodies = names.map((n) => {
    const m = SRC.match(new RegExp(`\\n  function ${n}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
    if (!m) throw new Error(`${n}() not found in embed.js`);
    return m[0];
  });
  const consts = ['WHITE', 'BLACK'].map((n) => SRC.match(new RegExp(`var ${n} = \\{[^}]*\\};`))![0]);
  return new Function(
    `${consts.join('\n')}\n${bodies.join('\n')}\nreturn {${names.join(',')}};`
  )();
}

const M = load();
const tokens = (m: Record<string, unknown>) => M.deriveTokens(m).vars as Record<string, string>;

// Fixtures mirror the two mock sites the change was verified against.
const KETTLE = { bg: 'rgb(244, 239, 230)', ink: 'rgb(43, 31, 51)' };   // sand paper, plum ink
const VOLT = { bg: 'rgb(11, 13, 16)', ink: 'rgb(232, 236, 241)' };     // near-black, off-white

describe('parseColor', () => {
  it('reads the shapes getComputedStyle actually returns', () => {
    expect(M.parseColor('rgb(43, 31, 51)')).toMatchObject({ r: 43, g: 31, b: 51, a: 1 });
    expect(M.parseColor('rgba(0, 0, 0, 0.5)')).toMatchObject({ r: 0, g: 0, b: 0, a: 0.5 });
    // Modern space/slash syntax — Chrome returns this for some declarations.
    expect(M.parseColor('rgb(10 20 30 / 0.4)')).toMatchObject({ r: 10, g: 20, b: 30, a: 0.4 });
  });

  it('reads hex, since authors write it in data-accent', () => {
    expect(M.parseColor('#4e9e6a')).toMatchObject({ r: 78, g: 158, b: 106 });
    expect(M.parseColor('#abc')).toMatchObject({ r: 170, g: 187, b: 204 });
  });

  it('returns null rather than a wrong color for what it cannot read', () => {
    // `transparent`, keywords and gradients must not resolve to black — black
    // would read as a dark page and flip the whole palette.
    for (const v of ['', 'transparent', 'currentColor', 'oklch(0.7 0.1 200)', 'nonsense', null, undefined]) {
      expect(M.parseColor(v as string), `parsed ${v}`).toBeNull();
    }
  });
});

describe('deriveTokens — colors are relationships, not constants', () => {
  it('adopts the page ink and background verbatim', () => {
    const t = tokens(KETTLE);
    expect(t['--gv-ink']).toBe('rgb(43,31,51)');
    expect(t['--gv-bg']).toBe('rgb(244,239,230)');
  });

  it('never emits grove’s own palette for a page that never chose it', () => {
    const all = Object.values(tokens(KETTLE)).join(' ').toLowerCase();
    for (const grove of ['#1a2e1f', '#f5f3ed', '#e6e2d6', '#7a8a7d', '#4e9e6a']) {
      expect(all, `leaked ${grove}`).not.toContain(grove);
    }
  });

  it('lifts cards off a light page and off a dark one alike', () => {
    // The relationship that has to hold on both: a card is distinguishable
    // from the page behind it. Direction differs, presence doesn't.
    const light = M.parseColor(tokens(KETTLE)['--gv-surface']);
    const dark = M.parseColor(tokens(VOLT)['--gv-surface']);
    expect(M.luminance(light)).toBeGreaterThan(M.luminance(M.parseColor(KETTLE.bg)));
    expect(M.luminance(dark)).toBeGreaterThan(M.luminance(M.parseColor(VOLT.bg)));
  });

  it('never makes text on a card harder to read than text on the page', () => {
    // The mid-tone hole. A 7% lift toward white is free on a near-black page,
    // where near-white ink reads at 16:1. On a #6f7278 page with the same ink
    // there is only 4.3:1 to spend, and the lift dropped grove's cards to
    // 3.7 — below AA, and visibly worse than the identical text beside it.
    const MIDGREY = { bg: 'rgb(111,114,120)', ink: 'rgb(242,242,240)' };
    const t = tokens(MIDGREY as any);
    const ink = M.parseColor(t['--gv-ink']);
    const onPage = M.contrast(ink, M.parseColor(MIDGREY.bg));
    const onCard = M.contrast(ink, M.parseColor(t['--gv-surface']));
    expect(onCard).toBeGreaterThanOrEqual(Math.min(4.5, onPage) - 0.01);
  });

  it('still lifts the card where the page has contrast to spare', () => {
    // The cap must not flatten the ordinary dark page, which is the case the
    // lift exists for.
    const s = M.parseColor(tokens(VOLT)['--gv-surface']);
    expect(M.luminance(s)).toBeGreaterThan(M.luminance(M.parseColor(VOLT.bg)));
  });

  it('keeps body text on the page ink and secondary text below it', () => {
    for (const page of [KETTLE, VOLT]) {
      const t = tokens(page);
      const ink = M.parseColor(t['--gv-ink']);
      const muted = M.parseColor(t['--gv-muted']);
      const bg = M.parseColor(t['--gv-bg']);
      // Muted sits between ink and background — dimmer than body text, still
      // legible. Asserted as contrast so it holds on light and dark both.
      expect(M.contrast(muted, bg)).toBeLessThan(M.contrast(ink, bg));
      expect(M.contrast(muted, bg)).toBeGreaterThan(2.2);
    }
  });

  it('reports dark pages as dark so the class-based rules switch too', () => {
    expect(M.deriveTokens(VOLT).dark).toBe(true);
    expect(M.deriveTokens(KETTLE).dark).toBe(false);
  });

  it('shadows stay black on a dark page instead of glowing', () => {
    // Tinting by ink is right on light pages and wrong on dark ones, where
    // ink is near-white and the "shadow" becomes a halo.
    expect(tokens(VOLT)['--gv-shadow']).toBe('rgba(0,0,0,0.55)');
    expect(tokens(KETTLE)['--gv-shadow']).toBe('rgba(43,31,51,0.22)');
  });

  it('inverts code blocks against the page, not against grove', () => {
    const onLight = M.parseColor(tokens(KETTLE)['--gv-code-bg']);
    const onDark = M.parseColor(tokens(VOLT)['--gv-code-bg']);
    expect(M.luminance(onLight)).toBeLessThan(0.1);          // dark slab on light page
    expect(M.luminance(onDark)).toBeGreaterThan(M.luminance(M.parseColor(VOLT.bg)));
  });
});

describe('deriveTokens — accent legibility', () => {
  // oveners' extracted brand color. Grove derives accents to read on WHITE
  // (lib/blog-theme accentForText), so a near-black one is correct on their
  // site and invisible the moment the embed lands on a dark page.
  const NEAR_BLACK = '#0b0b0e';

  it('lifts an unreadable accent until it clears the text contrast floor', () => {
    const t = tokens({ ...VOLT, accent: NEAR_BLACK });
    const accent = M.parseColor(t['--gv-accent']);
    expect(accent).not.toBeNull();
    // 4.5, not the 3.2 UI-component floor: .gv-kicker is 11px and .gv-badge is
    // 10px, so the accent is mostly small TEXT and 3.2 was the wrong bar.
    expect(M.contrast(accent, M.parseColor(VOLT.bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches the floor even when the accent starts on the page’s own side', () => {
    // A navy brand on a mid-grey page has to be dragged ACROSS the background
    // to read at all. Stepping 12% at a time approaches the pole without ever
    // arriving, so this used to stop at 4.4 against a 4.5 floor — a function
    // whose whole job is guaranteeing that floor, quietly not doing it.
    const bg = M.parseColor('rgb(111,114,120)');
    const out = M.readableOn(M.parseColor('#1e293b'), bg, 4.5);
    expect(M.contrast(out, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a brand color that is already bright enough for a dark page', () => {
    // The reason the API now sends accent_raw: pre-correcting grove's lime for
    // white produced a dark olive, and an olive that already clears the floor on
    // a near-black page is never lifted back — so the brand arrived muddy and
    // stayed muddy. Given the RAW color, a dark page keeps it as it is.
    const t = tokens({ ...VOLT, accent: '#a2ff01' });
    expect(t['--gv-accent']).toBe('rgb(162,255,1)');
    expect(M.contrast(M.parseColor(t['--gv-accent']), M.parseColor(VOLT.bg))).toBeGreaterThan(10);
  });

  it('leaves an already-legible accent alone', () => {
    const t = tokens({ ...KETTLE, accent: '#c2410c' });
    expect(t['--gv-accent']).toBe('rgb(194,65,12)');
  });

  it('prefers the accent measured on the page over the crawled brand color', () => {
    // The accent was the ONE token not measured — it came from a server-side
    // crawl of the customer's homepage, so it was right only if that crawl
    // picked the right color, is still current, AND the mount is on the brand
    // that was crawled. A page that states its own accent settles all three.
    const t = tokens({ ...KETTLE, accent: '#a2ff01', pageAccent: 'rgb(29,78,216)' } as any);
    expect(t['--gv-accent']).toBe('rgb(29,78,216)');
  });

  it('falls back to the crawled color when the page states no accent', () => {
    const t = tokens({ ...KETTLE, accent: '#c2410c', pageAccent: null } as any);
    expect(t['--gv-accent']).toBe('rgb(194,65,12)');
  });

  it('lets data-accent beat the measurement too', () => {
    // A pinned accent is an author's stated intent; a measurement is an
    // inference. The inference must not reach --gv-on-accent either, which has
    // to be contrast-checked against the color actually painted.
    const withMeasurement = tokens({ ...KETTLE, accent: '#a2ff01', pageAccent: 'rgb(29,78,216)', accentPinned: true } as any);
    const without = tokens({ ...KETTLE, accent: '#a2ff01', accentPinned: true } as any);
    expect(withMeasurement['--gv-accent']).toBeUndefined();
    // Identical either way: the measurement changed nothing, which is the point.
    expect(withMeasurement['--gv-on-accent']).toBe(without['--gv-on-accent']);
  });

  it('never overwrites an accent the author pinned with data-accent', () => {
    const t = tokens({ ...VOLT, accent: NEAR_BLACK, accentPinned: true });
    expect(t['--gv-accent']).toBeUndefined();
    // …but still contrast-checks it, so text on the accent fill stays readable.
    expect(t['--gv-on-accent']).toBeTruthy();
  });

  it('picks a foreground that survives on the accent fill', () => {
    for (const [page, accent] of [[KETTLE, '#ffe066'], [KETTLE, '#1e3a8a'], [VOLT, '#22d3ee']] as const) {
      const t = tokens({ ...page, accent });
      const fill = M.parseColor(t['--gv-accent'] ?? accent);
      expect(M.contrast(M.parseColor(t['--gv-on-accent']), fill)).toBeGreaterThan(3);
    }
  });
});

describe('deriveTokens — typography and geometry', () => {
  it('takes headings from the page’s headings, not its body text', () => {
    const t = tokens({ ...KETTLE, bodyFont: 'Palatino, serif', headFont: 'Georgia, serif' });
    expect(t['--gv-head-font']).toBe('Georgia, serif');
    expect(t['--gv-label-font']).toBe('Palatino, serif');
  });

  it('falls back to the body face when the page has no heading to sample', () => {
    const t = tokens({ ...KETTLE, bodyFont: 'Palatino, serif', headFont: null });
    expect(t['--gv-head-font']).toBe('Palatino, serif');
  });

  it('follows a squared-off system down to its chips', () => {
    // 999px pills next to 4px cards are the tell that two design systems are
    // in the same section.
    const t = tokens({ ...KETTLE, radius: 4 });
    expect(t['--gv-radius']).toBe('4px');
    expect(t['--gv-pill']).toBe('4px');
  });

  it('keeps pills where a pill is the idiom anyway', () => {
    const t = tokens({ ...KETTLE, radius: 12 });
    expect(t['--gv-radius']).toBe('12px');
    expect(t['--gv-pill']).toBe('999px');
  });

  it('squares itself completely on a site that squares everything', () => {
    // Radius 0 used to be discarded as "no system to copy", so a brutalist or
    // terminal-styled page got grove's 14px cards and 999px chips — the single
    // loudest way the section reads as imported from somewhere else.
    const t = tokens({ ...KETTLE, radius: 0 });
    expect(t['--gv-radius']).toBe('0px');
    expect(t['--gv-pill']).toBe('0px');
  });

  it('tells a brand color apart from the page’s own palette', () => {
    const bg = M.parseColor('rgb(250,247,240)');
    const ink = M.parseColor('rgb(46,36,25)');
    const ok = (hex: string) => M.isAccentCandidate(M.parseColor(hex), bg, ink);

    // Real accents from the host fixtures.
    for (const c of ['#8c5a2b', '#22d3ee', '#ff2d00', '#1d4ed8', '#ec4899', '#22c55e', '#10b981', '#e879f9']) {
      expect(ok(c), `${c} should read as an accent`).toBe(true);
    }
    // Neutrals are the page, not its accent.
    for (const c of ['#ffffff', '#000000', '#808080', '#f4f4f2', '#1a1a1a']) {
      expect(ok(c), `${c} should not read as an accent`).toBe(false);
    }
    // …nor is the page's own paper or ink in a slightly different shade.
    expect(ok('rgb(248,245,238)')).toBe(false);
    expect(ok('rgb(50,40,29)')).toBe(false);
    // A translucent fill tells us nothing about what will be painted.
    expect(M.isAccentCandidate(M.parseColor('rgba(29,78,216,0.1)'), bg, ink)).toBe(false);
  });

  it('reads the accent off buttons and labels, and lets repetition win', () => {
    // sampleAccent is the second measurement that touches the DOM, so its
    // selection rules are a source contract like sampleRadius's.
    const fn = SRC.match(/function sampleAccent\([\s\S]*?\n  \}/)![0];
    expect(fn).toMatch(/backgroundColor/);
    expect(fn).toMatch(/\bcs\.color\b|vals\s*=\s*\[cs\.backgroundColor, cs\.color\]/);
    expect(fn).toMatch(/isAccentCandidate/);
    // most-repeated wins, chroma breaks ties — one stray error badge must not
    // outvote the brand
    expect(fn).toMatch(/counts\[k\]/);
    expect(fn).toMatch(/chroma\(c\) > chroma\(best\)/);
    // and it must never sample from inside the embed itself
    expect(fn).toMatch(/root\.contains/);
  });

  it('only lets a painted element vote for square corners', () => {
    // …because 0 is also what every unstyled <a class> computes to, and letting
    // those vote would square almost every site on the web. sampleRadius is the
    // one measurement that touches the DOM, so this is a source contract.
    const fn = SRC.match(/function sampleRadius\([\s\S]*?\n  \}/)![0];
    expect(fn).toMatch(/r === 0/);                       // zero is considered…
    expect(fn).toMatch(/backgroundColor/);               // …only with a fill…
    expect(fn).toMatch(/borderTopWidth/);                // …or a border.
    expect(fn).not.toMatch(/r <= 0/);                    // never discarded outright
  });

  it('clamps a runaway measurement', () => {
    expect(tokens({ ...KETTLE, radius: 400 })['--gv-radius']).toBe('28px');
    expect(tokens({ ...KETTLE, radius: -5 })['--gv-radius']).toBe('0px');
  });
});

describe('deriveTokens — degrading safely', () => {
  it('themes nothing when the page cannot be read', () => {
    // Better grove's defaults than a palette derived from a half-measurement:
    // a missing background parsed as black would flip a light site to dark.
    for (const m of [{}, { bg: 'transparent', ink: 'rgb(0,0,0)' }, { bg: 'rgb(255,255,255)' }]) {
      const r = M.deriveTokens(m);
      expect(r.themed, JSON.stringify(m)).toBe(false);
      expect(r.vars['--gv-ink']).toBeUndefined();
      expect(r.vars['--gv-surface']).toBeUndefined();
    }
  });

  it('still inherits type and geometry when the colors are unreadable', () => {
    // Fonts don't depend on the palette, and getting them right is most of
    // what makes the section belong.
    const r = M.deriveTokens({ bodyFont: 'Inter, sans-serif', headFont: 'Fraunces, serif', radius: 6 });
    expect(r.themed).toBe(false);
    expect(r.vars['--gv-head-font']).toBe('Fraunces, serif');
    expect(r.vars['--gv-radius']).toBe('6px');
  });
});

describe('stylesheet contract', () => {
  // Rules are single-quoted strings in the injected array.
  const rules = SRC.match(/'\.gv[^']*\{[^']*\}'/g) ?? [];
  const base = SRC.split('\n').find((l) => l.includes("'.gv{"))!;

  it('sets no font-family that the host page cannot override', () => {
    // Every label in the embed used to be hardcoded `ui-monospace`, which is
    // grove's design language showing through on a customer's serif site.
    const offenders = rules.filter(
      (r) => /font-family:(?!var\(--gv-)/.test(r) && !r.startsWith("'.gv{")
    );
    expect(offenders, `hardcoded font-family in: ${offenders.join(' ')}`).toEqual([]);
  });

  it('routes every corner radius through a token', () => {
    const offenders = rules.filter((r) => /border-radius:(?!var\(--gv-|999px)/.test(r));
    expect(offenders, `hardcoded radius in: ${offenders.join(' ')}`).toEqual([]);
  });

  it('keeps grove’s palette only as a fallback, never as a value', () => {
    // A literal is fine as the second argument of var(...) — that's the
    // no-measurement path — but never on its own.
    for (const rule of rules) {
      if (rule.startsWith("'.gv{")) continue;
      const stripped = rule.replace(/var\([^)]*\)/g, '');
      for (const grove of ['#1a2e1f', '#f5f3ed', '#e6e2d6', '#7a8a7d']) {
        expect(stripped.toLowerCase(), `${grove} used directly in: ${rule}`).not.toContain(grove);
      }
    }
  });

  it('chains the dark article vars through the measured ones', () => {
    // `.gv.gv-dark .grove-article` (0,3,0) out-specifies article.css's
    // `.grove-article` (0,1,0). Without var(--gv-*) in front of each literal,
    // a measured dark page goes dark and then discards the palette it read.
    const darkArticle = SRC.match(/var DARK_ARTICLE = '([^']*)'/)![1];
    for (const decl of darkArticle.split(';')) {
      const [prop, value] = decl.split(/:(.+)/);
      expect(value, `${prop} does not chain through a --gv-* property`).toMatch(/^var\(--gv-/);
    }
  });

  it('applies the measured design in every mount mode', () => {
    // A mode that skips applyDesign silently keeps grove's palette.
    expect(SRC.match(/applyDesign\(root, window, document\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('measures the page, never the embed’s own styles', () => {
    // `.gv` sets `color:var(--gv-ink)`, so measuring the mount once it carries
    // that class reads grove's green back out and "inherits" it.
    expect(base).toContain('color:var(--gv-ink)');
    expect(SRC).toMatch(/var anchor = root\.parentElement/);
  });
});
