import { describe, it, expect } from 'vitest';
import {
  accentForText, isDark, blogThemeVars, fallbackPalette, embedTheme, brandingPayload,
  deriveBrandColors, resolveBranding, accentOn, contrastRatio,
  type BrandColors,
} from '../lib/blog-theme';

const branding: BrandColors = {
  primary_color: '#1d4ed8',
  secondary_color: '#f59e0b',
  btn_color: '#f59e0b',
  btn_text_color: '#1a2e1f',
  banner_bg: '#1d4ed8',
  banner_text: '#ffffff',
  banner_text_muted: 'rgba(255,255,255,0.65)',
  heading_font: null,
};

describe('accentForText', () => {
  it('keeps a dark color unchanged', () => {
    expect(accentForText('#1d4ed8')).toBe('#1d4ed8');
  });

  it('darkens a light color until it reads on white', () => {
    const out = accentForText('#fde047'); // light yellow
    expect(out).not.toBe('#fde047');
    expect(isDark(out)).toBe(true);
  });
});

describe('blogThemeVars', () => {
  it('returns undefined without branding, so pages keep grove defaults', () => {
    expect(blogThemeVars(null)).toBeUndefined();
    expect(blogThemeVars(undefined)).toBeUndefined();
  });

  it('maps the palette onto --moss and the --cta-* banner vars', () => {
    const vars = blogThemeVars(branding)!;
    expect(vars['--moss']).toBe('#1d4ed8');
    expect(vars['--accent-soft']).toMatch(/^rgba\(/);
    expect(vars['--cta-bg']).toBe('#1d4ed8');
    expect(vars['--cta-btn']).toBe('#f59e0b');
    expect(vars['--cta-btn-text']).toBe('#1a2e1f');
  });

  it('never puts an unreadably light primary into --moss', () => {
    const light = { ...branding, primary_color: '#fde047' };
    expect(isDark(blogThemeVars(light)!['--moss'])).toBe(true);
  });

  it('lifts the accent instead of darkening it when the page is dark', () => {
    // Hosted blogs now take their background from the customer's own site
    // (lib/site-design). accentForText darkens until a color reads on WHITE,
    // which on a near-black page hides the links, genre tags and heading rule
    // completely — the accent has to move away from the background it's on.
    const onDark = blogThemeVars(branding, { bg: '#000000', ink: '#ffffff' })!['--moss'];
    const onLight = blogThemeVars(branding, { bg: '#ffffff', ink: '#111111' })!['--moss'];
    expect(contrastRatio(onDark, '#000000')).toBeGreaterThanOrEqual(3.2);
    expect(contrastRatio(onLight, '#ffffff')).toBeGreaterThanOrEqual(3.2);
    expect(onDark).not.toBe(onLight);
  });

  it('keeps the old white-background behaviour when no background is known', () => {
    expect(blogThemeVars(branding)!['--moss']).toBe(accentForText(branding.primary_color));
  });

  it('leaves the banner deriving from the brand when there is no capture', () => {
    // Every blog without a design capture must render exactly as it does today.
    for (const page of [undefined, null, { bg: '#000000', ink: null }, { bg: null, ink: '#fff' }]) {
      const vars = blogThemeVars(branding, page)!;
      expect(vars['--cta-bg']).toBe(branding.banner_bg);
      expect(vars['--cta-btn']).toBe(branding.btn_color);
    }
  });

  describe('a bright accent on a dark site (grove’s own shape)', () => {
    // The case that forced a hand-set brand_override: lime is the accent, and
    // near-black is the surface. deriveBrandColors can only express one of them
    // through primary_color, so the banner used to be bought by flattening the
    // accent. With the page captured, both survive.
    const lime: BrandColors = { ...branding, primary_color: '#a2ff01', banner_bg: '#7abf01' };
    const page = { bg: '#000000', ink: '#f4f4f2' };

    it('keeps the accent bright instead of spending it on the banner', () => {
      const vars = blogThemeVars(lime, page)!;
      expect(vars['--moss']).toBe('#a2ff01');
      expect(contrastRatio(vars['--moss'], page.bg)).toBeGreaterThanOrEqual(3.2);
    });

    it('builds the banner from the site’s own surface, not a darkened brand', () => {
      const vars = blogThemeVars(lime, page)!;
      expect(vars['--cta-bg']).not.toBe(lime.banner_bg);      // not the lime-green block
      expect(isDark(vars['--cta-bg'])).toBe(true);            // lifted off black, still dark
      expect(vars['--cta-text']).toBe(page.ink);
      expect(contrastRatio(vars['--cta-text'], vars['--cta-bg'])).toBeGreaterThanOrEqual(4.5);
    });

    it('puts the brand on the button, readably', () => {
      const vars = blogThemeVars(lime, page)!;
      expect(contrastRatio(vars['--cta-btn'], vars['--cta-bg'])).toBeGreaterThanOrEqual(3.2);
      expect(contrastRatio(vars['--cta-btn-text'], vars['--cta-btn'])).toBeGreaterThanOrEqual(4.5);
      // and out of the site's own palette — never grove's ink green
      expect([page.bg, page.ink]).toContain(vars['--cta-btn-text']);
    });

    it('inverts into a dark card on a light site', () => {
      const vars = blogThemeVars(lime, { bg: '#ffffff', ink: '#111111' })!;
      expect(isDark(vars['--cta-bg'])).toBe(true);
      expect(vars['--cta-text']).toBe('#ffffff');
    });
  });
});

describe('accentOn', () => {
  it('leaves an accent that already reads alone', () => {
    expect(accentOn('#1d4ed8', '#ffffff')).toBe('#1d4ed8');
  });

  it('rescues a brand color that collides with the page', () => {
    // grove's own lime on grove's own black, and a near-black brand on white.
    for (const [accent, bg] of [['#a2ff01', '#000000'], ['#0b0b0e', '#ffffff'], ['#1d4ed8', '#0b0d10']] as const) {
      expect(contrastRatio(accentOn(accent, bg), bg), `${accent} on ${bg}`).toBeGreaterThanOrEqual(3.2);
    }
  });
});

describe('fallbackPalette', () => {
  it('returns grove greens without branding', () => {
    expect(fallbackPalette(null)).toContain('#4e9e6a');
  });

  it('builds a brand-family palette that is dark enough for white initials', () => {
    const palette = fallbackPalette(branding);
    expect(palette.length).toBeGreaterThanOrEqual(2);
    for (const c of palette) expect(isDark(c)).toBe(true);
  });

  it('tolerates profiles saved before secondary_color existed', () => {
    const legacy = { ...branding, secondary_color: undefined };
    expect(() => fallbackPalette(legacy)).not.toThrow();
    expect(fallbackPalette(legacy).length).toBeGreaterThanOrEqual(2);
  });
});

describe('embedTheme', () => {
  it('serves grove defaults without branding', () => {
    const t = embedTheme(null);
    expect(t.accent).toBe('#4e9e6a');
    expect(t.bannerFrom).toBe('#16271c');
    expect(t.btn).toBe('#5bb87e');
  });

  it('serves the customer palette when branding exists', () => {
    const t = embedTheme(branding);
    expect(t.bannerFrom).toBe('#1d4ed8');
    expect(t.btn).toBe('#f59e0b');
    expect(t.btnText).toBe('#1a2e1f');
    expect(t.bannerText).toBe('#ffffff');
    // gradient end is a darker shade of the banner bg
    expect(t.bannerTo).not.toBe(t.bannerFrom);
  });
});

describe('deriveBrandColors', () => {
  it('builds a full palette from just a primary', () => {
    const c = deriveBrandColors('#1d4ed8');
    expect(c.primary_color).toBe('#1d4ed8');
    expect(c.secondary_color).toBeTruthy();       // darkened primary fallback
    expect(c.banner_bg).toBe('#1d4ed8');           // dark primary → banner = primary
    expect(c.banner_text).toBe('#ffffff');
    expect(c.banner_text_muted).toMatch(/^rgba\(/);
  });

  it('uses the secondary as the button color', () => {
    const c = deriveBrandColors('#1d4ed8', { secondary: '#f59e0b' });
    expect(c.secondary_color).toBe('#f59e0b');
    expect(c.btn_color).toBe('#f59e0b');
    expect(c.btn_text_color).toBe('#1a2e1f');       // light button → dark text
  });

  it('darkens a light primary for the banner background', () => {
    const c = deriveBrandColors('#93c5fd'); // light blue
    expect(c.banner_bg).not.toBe('#93c5fd');
    expect(parseInt(c.banner_bg.slice(1, 3), 16)).toBeLessThan(0x93);
  });

  it('matches what extraction produces for the same colors', async () => {
    // extraction routes through deriveBrandColors, so a crawled palette and a
    // hand-picked one with the same primary/btn must be identical downstream.
    const { extractBrandColors } = await import('../lib/pipeline/site-profile');
    const crawled = extractBrandColors(
      `<style>:root{--primary:#1d4ed8;--accent:#f59e0b}</style>`
    )!;
    const manual = deriveBrandColors('#1d4ed8', { secondary: '#f59e0b', btn: '#f59e0b' });
    expect(manual.banner_bg).toBe(crawled.banner_bg);
    expect(manual.btn_color).toBe(crawled.btn_color);
    expect(manual.btn_text_color).toBe(crawled.btn_text_color);
    expect(manual.banner_text).toBe(crawled.banner_text);
  });
});

describe('resolveBranding', () => {
  const crawledColors: BrandColors = { ...branding, primary_color: '#111111' };
  const overrideColors: BrandColors = { ...branding, primary_color: '#c026d3' };

  it('returns null when neither override nor crawl exists', () => {
    expect(resolveBranding({})).toBeNull();
    expect(resolveBranding({ site_profile: {} })).toBeNull();
  });

  it('uses crawled branding when no override is set', () => {
    const d = { site_profile: { branding: crawledColors } };
    expect(resolveBranding(d)!.primary_color).toBe('#111111');
  });

  it('lets a manual override win over the crawled colors', () => {
    const d = { brand_override: overrideColors, site_profile: { branding: crawledColors } };
    expect(resolveBranding(d)!.primary_color).toBe('#c026d3');
  });

  it('ignores an empty/malformed override object', () => {
    const d = { brand_override: {}, site_profile: { branding: crawledColors } };
    expect(resolveBranding(d)!.primary_color).toBe('#111111');
  });
});

describe('brandingPayload', () => {
  it('is null without branding', () => {
    expect(brandingPayload(null)).toBeNull();
  });

  it('exposes the palette plus a text-safe accent', () => {
    const p = brandingPayload({ ...branding, primary_color: '#fde047' })!;
    expect(p.primary_color).toBe('#fde047');
    expect(p.secondary_color).toBe('#f59e0b');
    expect(isDark(p.accent)).toBe(true);
  });

  it('falls back to btn_color for legacy profiles without secondary', () => {
    const p = brandingPayload({ ...branding, secondary_color: undefined })!;
    expect(p.secondary_color).toBe('#f59e0b');
  });
});
