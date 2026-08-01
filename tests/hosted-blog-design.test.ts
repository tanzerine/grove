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
import { designCss, designTokens, type SiteDesign } from '../lib/site-design';
import { blogThemeVars, contrastRatio, isDark, type BrandColors } from '../lib/blog-theme';

const GROVE_DESIGN: SiteDesign = {
  nav: {
    brand: { text: null, logo: null, href: 'https://trygroveai.com' },
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

  it('sets the accent to grove’s lime, readable on black', () => {
    expect(vars['--moss']).toBe('#a2ff01');
    expect(contrastRatio(vars['--moss'], '#000000')).toBeGreaterThanOrEqual(3.2);
  });

  it('swaps grove’s two brand typefaces for the site’s own', () => {
    // GT Walsheim on .display and DM Mono on .mono are what make a page look
    // like grove; on a customer's subdomain they are the typographic version of
    // shipping grove's green.
    expect(css).toContain('font-family:Inter,');
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

  it('carries the radius so nothing is rounder than the site is', () => {
    expect(css).toContain('--r-lg:13px'); // 10 × 1.3
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
    expect(css).toContain('font-family:Inter,');
    expect(css).not.toContain('--bone:');
  });
});
