import { describe, it, expect } from 'vitest';
import {
  accentForText, isDark, blogThemeVars, fallbackPalette, embedTheme, brandingPayload,
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
