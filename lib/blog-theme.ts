/**
 * Blog theming — turns the BrandColors extracted from a customer's homepage
 * (lib/pipeline/site-profile.ts) into the CSS custom properties every blog
 * surface consumes: the hosted pages (/b/*), the embed article HTML, and
 * embed.js. Keeping the mapping here means the banner, TOC, and cards can't
 * drift apart — they all read the same palette.
 */

export type BrandColors = {
  primary_color: string;
  secondary_color?: string;         // optional: profiles saved before extraction learned it
  btn_color: string;
  btn_text_color: string;
  banner_bg: string;
  banner_text: string;
  banner_text_muted: string;
  heading_font: string | null;
};

// ─── color utils ─────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length === 3) {
    return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
  }
  if (h.length === 6) {
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  return null;
}

export function relativeLuminance(rgb: { r:number; g:number; b:number }): number {
  const lin = (c: number) => { const s=c/255; return s<=0.03928 ? s/12.92 : ((s+0.055)/1.055)**2.4; };
  return 0.2126*lin(rgb.r) + 0.7152*lin(rgb.g) + 0.0722*lin(rgb.b);
}

export function isDark(hex: string): boolean {
  const rgb = hexToRgb(hex);
  return !rgb || relativeLuminance(rgb) < 0.179;
}

export function contrastColor(hex: string): string {
  return isDark(hex) ? '#ffffff' : '#1a2e1f';
}

export function withOpacity(hex: string, opacity: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${opacity})` : hex;
}

export function hexToHsl(hex: string): { h:number; s:number; l:number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r=rgb.r/255, g=rgb.g/255, b=rgb.b/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, s=0;
  const l=(max+min)/2;
  if (max!==min) {
    const d=max-min;
    s = l>0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return { h:Math.round(h*360), s:Math.round(s*100), l:Math.round(l*100) };
}

export function darkenHex(hex: string, amount=0.25): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const f=1-amount;
  const r=Math.round(rgb.r*f), g=Math.round(rgb.g*f), b=Math.round(rgb.b*f);
  return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}

/**
 * A brand primary is often too light to survive as text, a thin border, or a
 * hover accent on the blog's paper/white surfaces (think a pastel or a neon).
 * Darken until it reads — ~4.5:1 against white, the same threshold isDark uses.
 */
export function accentForText(hex: string): string {
  let c = hex;
  for (let i = 0; i < 8 && !isDark(c); i++) c = darkenHex(c, 0.16);
  return c;
}

export function lightenHex(hex: string, amount = 0.25): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const up = (v: number) => Math.round(v + (255 - v) * amount);
  return '#' + [up(rgb.r), up(rgb.g), up(rgb.b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const la = relativeLuminance(ra), lb = relativeLuminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The accent, made legible against the background it will actually sit on.
 *
 * accentForText() darkens until a color reads on WHITE, which was a safe
 * assumption while every blog surface was grove's paper. It stopped being one
 * when hosted blogs began taking their background from the customer's own site
 * (lib/site-design): on a near-black page the darkened accent is invisible, so
 * links, genre tags and the heading rule quietly vanish. Given a background,
 * move the accent away from it instead of always downward.
 *
 * 3.2:1 — the WCAG floor for large text and UI components, which is what the
 * accent is used for.
 */
export function accentOn(hex: string, bg: string | null | undefined): string {
  if (!bg) return accentForText(hex);
  const towardLight = isDark(bg);
  let c = hex;
  for (let i = 0; i < 10 && contrastRatio(c, bg) < 3.2; i++) {
    c = towardLight ? lightenHex(c, 0.14) : darkenHex(c, 0.14);
  }
  return c;
}

/**
 * Build a full BrandColors from a primary (+ optional secondary) color. This is
 * the single source of truth for turning a couple of brand colors into the
 * banner/button palette — both the homepage extractor and the manual
 * color-picker in the dashboard go through here, so a hand-picked palette and a
 * crawled one derive identical downstream colors.
 */
export function deriveBrandColors(
  primary: string,
  opts: { secondary?: string; btn?: string; headingFont?: string | null } = {},
): BrandColors {
  const secondary = opts.secondary || darkenHex(primary, 0.3);
  const btn = opts.btn || secondary;
  const bannerBg = isDark(primary) ? primary : darkenHex(primary);
  const bannerText = contrastColor(bannerBg);
  return {
    primary_color: primary,
    secondary_color: secondary,
    btn_color: btn,
    btn_text_color: contrastColor(btn),
    banner_bg: bannerBg,
    banner_text: bannerText,
    banner_text_muted: withOpacity(bannerText, 0.65),
    heading_font: opts.headingFont ?? null,
  };
}

/**
 * The palette a blog surface should actually use, in precedence order:
 * a manual override the owner set in the dashboard (domains.brand_override)
 * wins over the colors crawled from their homepage (site_profile.branding),
 * which is null when neither exists. Every render path reads through this so
 * the precedence can't drift between the hosted pages and the embed.
 */
export function resolveBranding(domain: any): BrandColors | null {
  const override = domain?.brand_override;
  if (override && override.primary_color) return override as BrandColors;
  return domain?.site_profile?.branding ?? null;
}

// ─── theme builders ──────────────────────────────────────────────────────────

/**
 * CSS custom properties for the hosted blog pages. Setting --moss on the page
 * root retints everything the blog styles hang off it — TOC hover, genre tags,
 * card hover borders, chips, read-progress bar — while --cta-* themes the
 * "Try {business}" banner. Returns undefined when no branding was extracted,
 * so pages fall back to Grove's own palette.
 */
export function blogThemeVars(
  branding: BrandColors | null | undefined,
  /** The page background this palette will sit on, when it's known — see accentOn. */
  bg?: string | null,
): Record<string, string> | undefined {
  if (!branding?.primary_color) return undefined;
  const accent = accentOn(branding.primary_color, bg);
  return {
    '--moss': accent,
    '--moss2': darkenHex(accent, 0.15),
    '--accent-soft': withOpacity(accent, 0.10),
    '--cta-bg': branding.banner_bg,
    '--cta-text': branding.banner_text,
    '--cta-text-muted': branding.banner_text_muted,
    '--cta-btn': branding.btn_color,
    '--cta-btn-text': branding.btn_text_color,
  };
}

/**
 * Flat background colors for posts without a cover image. The initial glyph on
 * top is near-white, so every entry must be dark enough to carry it. Falls back
 * to Grove's green family when the domain has no extracted branding.
 */
const GROVE_FALLBACKS = ['#4e9e6a', '#2f6b4f', '#7a8a7d', '#1a2e1f'];

export function fallbackPalette(branding: BrandColors | null | undefined): string[] {
  if (!branding?.primary_color) return GROVE_FALLBACKS;
  const accent = accentForText(branding.primary_color);
  const secondary = accentForText(branding.secondary_color || branding.btn_color || accent);
  const set = new Set([accent, secondary, darkenHex(accent, 0.3), branding.banner_bg]);
  return [...set];
}

/**
 * Colors for the self-contained CTA + TOC HTML the embed article API returns.
 * Grove's dark-green defaults apply only when the domain has no branding.
 */
export type EmbedTheme = {
  accent: string;      // links, TOC hover, chip highlights — readable on white
  bannerFrom: string;  // CTA gradient start
  bannerTo: string;    // CTA gradient end
  bannerText: string;
  bannerMuted: string; // kicker + subline on the banner
  btn: string;
  btnText: string;
};

export function embedTheme(branding: BrandColors | null | undefined): EmbedTheme {
  if (!branding?.primary_color) {
    return {
      accent: '#4e9e6a',
      bannerFrom: '#16271c',
      bannerTo: '#1f3a29',
      bannerText: '#ffffff',
      bannerMuted: 'rgba(255,255,255,.82)',
      btn: '#5bb87e',
      btnText: '#0f1f15',
    };
  }
  return {
    accent: accentForText(branding.primary_color),
    bannerFrom: branding.banner_bg,
    bannerTo: darkenHex(branding.banner_bg, 0.3),
    bannerText: branding.banner_text,
    bannerMuted: branding.banner_text_muted,
    btn: branding.btn_color,
    btnText: branding.btn_text_color,
  };
}

/**
 * The branding block embed endpoints expose so customer-side renderers (and
 * embed.js itself) can match the blog to the site without re-deriving colors.
 */
export function brandingPayload(branding: BrandColors | null | undefined) {
  if (!branding?.primary_color) return null;
  return {
    primary_color: branding.primary_color,
    secondary_color: branding.secondary_color ?? branding.btn_color,
    accent: accentForText(branding.primary_color),
    banner_bg: branding.banner_bg,
    banner_text: branding.banner_text,
    btn_color: branding.btn_color,
    btn_text_color: branding.btn_text_color,
  };
}
