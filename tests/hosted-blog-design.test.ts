/**
 * The hosted blog has to end up wearing the site it belongs to.
 *
 * `designCss` and `blogThemeVars` are each covered on their own, but the bug
 * that prompted this file lived between them: grove's own article page at
 * /b/{slug}/{post} rendered the old paper skin with a near-black accent while
 * trygroveai.com next to it was black with a lime one, and every unit test
 * passed. What was missing was an assertion about the COMBINED output for a
 * real captured site.
 *
 * The fixture is the real capture — the literal return of
 * captureSiteDesign('trygroveai.com') — so this also pins the contract the
 * extractor has to keep meeting. We are the loudest customer of this feature;
 * if it can't dress grove's own blog it can't dress anyone's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designCss, designTokens, extractNav, type SiteDesign } from '../lib/site-design';
import { blogThemeVars, contrastRatio, isDark, type BrandColors } from '../lib/blog-theme';

const GROVE_DESIGN: SiteDesign = {
  nav: {
    // The brand link is a SIBLING of grove's nav container, so it fell outside
    // the captured window and both fields came back null — the blog's header
    // then had no mark at all. brandFromTopOfPage recovers it.
    brand: { text: 'Grove', logo: 'https://trygroveai.com/landing/grove-mark.png', href: 'https://trygroveai.com' },
    links: [
      { label: 'Agents', href: 'https://trygroveai.com/#agents' },
      { label: 'Platform', href: 'https://trygroveai.com/#platform' },
      { label: 'Pricing', href: 'https://trygroveai.com/#pricing' },
      { label: 'Blog', href: 'https://trygroveai.com/blog' },
      { label: 'FAQ', href: 'https://trygroveai.com/#faq' },
    ],
    cta: { label: 'See how it works', href: 'https://trygroveai.com/#agents' },
  },
  fonts: {
    body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
    heading: "'GT Walsheim'",
    stylesheets: ['https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'],
  },
  colors: { bg: '#000000', ink: '#f4f4f2' },
  radius: 10,
};

/** What the crawler extracts from trygroveai.com — lime, not the dark surface. */
const GROVE_BRANDING: BrandColors = {
  primary_color: '#a2ff01',
  secondary_color: '#ff9b9b',
  btn_color: '#d9ff8f',
  btn_text_color: '#1a2e1f',
  banner_bg: '#7abf01',
  banner_text: '#1a2e1f',
  banner_text_muted: 'rgba(26,46,31,0.65)',
  heading_font: 'GT Walsheim',
};

describe('grove’s own hosted blog wears grove', () => {
  const css = designCss(GROVE_DESIGN)!;
  const vars = blogThemeVars(GROVE_BRANDING, GROVE_DESIGN.colors)!;

  it('paints the page in the site’s colors, not the blog’s old paper', () => {
    expect(css).toContain('--bone:#000000');
    expect(css).toContain('--ink:#f4f4f2');
    expect(css).toContain('body{background:var(--bone);color:var(--ink)}');
    // #fcfbf7 is grove's bone. Seeing it here means the capture did not apply.
    expect(css).not.toContain('#fcfbf7');
  });

  it('lifts cards off a black page instead of leaving them white', () => {
    const tokens = designTokens(GROVE_DESIGN)!;
    expect(isDark(tokens['--surface'])).toBe(true);
    expect(tokens['--surface']).not.toBe('#ffffff');
    // The article card reads --surface with a `white` fallback; a dark site that
    // captured colors must never fall back to it.
    expect(tokens['--surface']).toBeTruthy();
  });

  it('recesses code blocks instead of inverting a dark page into a white slab', () => {
    const tokens = designTokens(GROVE_DESIGN)!;
    expect(isDark(tokens['--code-bg'])).toBe(true);
    expect(contrastRatio(tokens['--code-ink'], tokens['--code-bg'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the familiar dark code slab on a light site', () => {
    const tokens = designTokens({ ...GROVE_DESIGN, colors: { bg: '#ffffff', ink: '#111111' } })!;
    expect(tokens['--code-bg']).toBe('#111111');
    expect(tokens['--code-ink']).toBe('#ffffff');
  });

  it('ships the fonts as properties, not only as element rules', () => {
    // The element rules lose on specificity to `.cta-banner h3` (0,1,1) and
    // `.share-btn` (0,1,0), which name grove's Inter and DM Mono directly. A
    // custom property cannot be out-specified, so it is the only mechanism that
    // actually reaches those components.
    expect(css).toContain('--body-font:');
    expect(css).toContain('--label-font:');
    expect(css).toContain('--head-font:');
    // labels take the customer's body face — grove's DM Mono is grove's
    expect(css).not.toMatch(/--label-font:[^;}]*DM Mono/);
  });

  it('leaves no fixed light literal in the article body', () => {
    // Every one of these banded a dark article with light: the table zebra, the
    // link hairline tinted from grove's ink, and the inverted code block.
    const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const prose = globals.slice(globals.indexOf('.prose {'), globals.indexOf('.hosted-nav'));
    const bare = (prose.match(/(?:background|border-bottom|color)\s*:[^;}]*(?:rgba?\((?!\s*255\s*,\s*255\s*,\s*255)[\d.,\s]+\)|#[0-9a-fA-F]{3,6})/g) ?? [])
      .filter((r) => !r.includes('var(') && !r.includes('color-mix'));
    expect(bare, `fixed color in .prose: ${bare.join(' | ')}`).toEqual([]);
  });

  it('sets the accent to grove’s lime, readable on black', () => {
    expect(vars['--moss']).toBe('#a2ff01');
    expect(contrastRatio(vars['--moss'], '#000000')).toBeGreaterThanOrEqual(3.2);
  });

  it('swaps grove’s two brand typefaces for the site’s own', () => {
    // GT Walsheim on .display and DM Mono on .mono are what make a page look
    // like grove; on a customer's subdomain they are the typographic version of
    // shipping grove's green.
    expect(css).toContain('--body-font:Inter,');
    expect(css).not.toMatch(/font-family:[^;}]*DM Mono/);
  });

  it('reproduces the site’s real navigation rather than a name and a Blog link', () => {
    // The degraded header ("Grove" + an auto-added Blog link) is what renders
    // when nav capture is missing — a reader arriving from search then has no
    // way into the site the blog belongs to.
    expect(GROVE_DESIGN.nav!.links.map((l) => l.label)).toEqual(
      ['Agents', 'Platform', 'Pricing', 'Blog', 'FAQ'],
    );
    expect(GROVE_DESIGN.nav!.cta).not.toBeNull();
  });

  it('recovers a brand link that sits outside the nav container', () => {
    // grove's landing is `<a href="#hero"><img/>Grove</a>` NEXT TO
    // `<div class="gv-navlinks">`, which is the standard flex-header shape —
    // the class-matched window sees the links and not the mark.
    const html = `<body><div hidden></div><div style="position:fixed">` +
      `<a href="#hero"><span><img src="/landing/grove-mark.png" alt="Grove"/></span><span>Grove</span></a>` +
      `<div class="gv-navlinks"><a href="#agents">Agents</a><a href="#pricing">Pricing</a><a href="/blog">Blog</a></div>` +
      `</div></body>`;
    const nav = extractNav(html, 'https://trygroveai.com/')!;
    expect(nav.brand.logo).toBe('https://trygroveai.com/landing/grove-mark.png');
    expect(nav.brand.text).toBe('Grove');
    expect(nav.links.map((l) => l.label)).toEqual(['Agents', 'Pricing', 'Blog']);
  });

  it('does not invent a mark from a page that has none', () => {
    const html = `<body><nav><a href="/">Acme</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a></nav></body>`;
    expect(extractNav(html, 'https://acme.com/')!.brand.logo).toBeNull();
  });

  it('carries the radius so nothing is rounder than the site is', () => {
    expect(css).toContain('--r-lg:13px'); // 10 × 1.3
  });
});

/**
 * The rule the hosted blog lives by, applied to the whole stylesheet band
 * rather than one component at a time.
 *
 * Every offender below rendered correctly on grove's paper and wrongly on a
 * captured site, which is why they all survived: `.bi-card{background:white}`
 * put white slabs in a black article, `.share-btn` and `.cta-banner h3` named
 * grove's DM Mono and Inter and out-specified the element rules meant to
 * replace them, and the hover shadows were grove's green at an alpha that
 * shows nothing on black.
 */
describe('no grove literal survives on a customer’s blog', () => {
  const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
  // The hosted nav through the share row — everything a customer's blog paints,
  // delimited by a sentinel comment so the slice can't silently drift.
  const band = globals.slice(globals.indexOf('.hosted-nav {'), globals.indexOf('/* ── end hosted blog ──'));
  const rules = [...band.matchAll(/(^|\n)([^\n{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[2].trim(), body: m[3] }))
    .filter((r) => !r.sel.startsWith('@'))
    // `.grove-*` (the live-generation timeline) is filed inside this band but
    // renders in the dashboard, never on a customer's blog. Grove's colors are
    // correct there.
    .filter((r) => !r.sel.startsWith('.grove-'));

  it('covers a real slice of the stylesheet', () => {
    expect(band.length).toBeGreaterThan(1500);
    expect(rules.length).toBeGreaterThan(15);
  });

  it('names neither of grove’s two brand typefaces without a token in front', () => {
    // Grove's faces are fine as the FALLBACK inside var(--label-font, …) —
    // that's what a blog with no capture should render. They are not fine as
    // the whole value, which is what no capture can ever override.
    const GROVE_FACE = /'DM Mono'|'Inter'|'GT Walsheim'/;
    const bare = rules.filter((r) =>
      [...r.body.matchAll(/font-family:\s*([^;}]*)/g)]
        .some(([, value]) => !value.trim().startsWith('var(') && GROVE_FACE.test(value)));
    expect(bare.map((r) => r.sel), 'grove font hardcoded').toEqual([]);
  });

  it('paints no surface with a fixed color', () => {
    const bare = rules.filter((r) =>
      /background(?:-color)?:\s*(?:white|#[0-9a-fA-F]{3,6})(?![^;}]*var\()/.test(r.body));
    expect(bare.map((r) => r.sel), 'fixed surface color').toEqual([]);
  });

  it('casts no shadow in grove’s green', () => {
    // rgba(26,46,31,…) / rgba(21,40,27,…) are --ink and its shadow tint.
    const bare = rules.filter((r) => /box-shadow:[^;}]*rgba\(\s*(?:26,\s*46|21,\s*40|63,\s*143)/.test(r.body));
    expect(bare.map((r) => r.sel), 'grove-hue shadow').toEqual([]);
  });

  it('puts readable text on an accent fill', () => {
    // `color: white` on a fill that is the brand accent is a coin flip — it is
    // unreadable on grove's own lime. --on-accent is chosen against the accent.
    const onAccent = rules.filter((r) => /background:\s*var\(--moss\)/.test(r.body));
    expect(onAccent.length).toBeGreaterThan(0);
    for (const r of onAccent) {
      expect(r.body, `${r.sel} hardcodes its foreground on the accent`).not.toMatch(/color:\s*(white|#fff)/);
    }
  });
});

describe('the hosted nav is the landing’s bar', () => {
  const globals = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
  const nav = globals.slice(globals.indexOf('.hosted-nav {'), globals.indexOf('.post-shell {'));

  it('is the same translucent blurred strip', () => {
    expect(nav).toMatch(/position:\s*sticky/);
    expect(nav).toContain('backdrop-filter: blur(16px)');
    // …and the translucency is of the captured page, not a fixed black.
    expect(nav).toMatch(/background:\s*color-mix\([^;]*var\(--bone\)/);
  });

  it('inverts the CTA rather than tinting it with the brand', () => {
    // The landing's is #f4f4f2 on #0a0a0a — the page inverted, which stays the
    // highest-contrast element in the bar whatever a customer's brand is.
    const cta = nav.slice(nav.indexOf('.hosted-nav-cta'));
    expect(cta).toContain('background: var(--ink)');
    expect(cta).toContain('color: var(--bone)');
    expect(cta).not.toMatch(/background:[^;]*var\(--moss\)/);
  });

  it('matches the landing’s measurements', () => {
    for (const v of ['max-width: 1200px', 'padding: 16px 24px', 'gap: 26px', 'height: 32px']) {
      expect(nav, `nav lost ${v}`).toContain(v);
    }
  });
});

describe('the dashboard preview shows what the blog renders', () => {
  const form = readFileSync(join(process.cwd(), 'app/dashboard/embed/ThemeColorsForm.tsx'), 'utf8');

  it('derives the preview banner through blogThemeVars, not deriveBrandColors', () => {
    // The preview's comment claimed it used "the same derivation the blog will
    // use". That stopped being true when the banner started being built from
    // the captured page: for grove's own domain the preview drew a #7abf01
    // yellow-green slab with a salmon button while the blog rendered a #181818
    // card with a lime one, so the owner was tuning against a fiction.
    expect(form).toContain('blogThemeVars');
    expect(form).toContain('pageColors');
    // …and the markup must read the resolved values, not the raw derivation.
    expect(form).not.toMatch(/background:\s*derived\.banner_bg/);
    expect(form).not.toMatch(/background:\s*derived\.btn_color/);
  });

  it('agrees with the hosted page for a captured site', () => {
    const branding = { ...GROVE_BRANDING };
    const page = GROVE_DESIGN.colors;
    const preview = blogThemeVars(branding, page)!;   // what the form now draws
    const rendered = blogThemeVars(branding, page)!;  // what app/b/[slug] draws
    expect(preview['--cta-bg']).toBe(rendered['--cta-bg']);
    // and it is the captured surface, not the darkened brand color
    expect(preview['--cta-bg']).not.toBe(branding.banner_bg);
    expect(isDark(preview['--cta-bg'])).toBe(true);
  });
});

describe('a site grove could not capture', () => {
  it('keeps grove’s own look, exactly as before the feature', () => {
    expect(designCss(null)).toBeNull();
    expect(designCss({ ...GROVE_DESIGN, colors: { bg: null, ink: null }, fonts: { body: null, heading: null, stylesheets: [] } })).toBeNull();
  });

  it('applies the half it did capture', () => {
    const fontsOnly = { ...GROVE_DESIGN, colors: { bg: null, ink: null } };
    const css = designCss(fontsOnly)!;
    expect(css).toContain('--body-font:Inter,');
    expect(css).not.toContain('--bone:');
  });
});
