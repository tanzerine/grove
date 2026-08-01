/**
 * Capturing a customer's design from their homepage.
 *
 * The embed can measure the page it's mounted in (public/embed.js). A blog
 * grove HOSTS — `blog.acme.com` via `domains.custom_blog_hostname`, or
 * `/b/{slug}` — has no such page: grove's own server renders it end to end, so
 * until now it rendered in grove's own clothes. Bone background, GT Walsheim
 * and Inter, DM Mono labels, and no navigation at all beyond a `← hostname`
 * link. A customer who followed the dashboard's "Step 1 · Own the SEO" landed
 * on a blog that shared nothing with the site it was supposed to belong to.
 *
 * So for that surface the design has to be captured rather than measured. The
 * homepage is already fetched during profiling (lib/pipeline/site-profile.ts),
 * along with its stylesheets — this module turns that same HTML and CSS into
 * the tokens and the navigation the hosted pages render.
 *
 * PURE AND TOTAL. Every function takes strings and returns data; nothing
 * fetches, and nothing throws on malformed input — a homepage we cannot parse
 * must degrade to grove's own look, never to a broken page. Partial captures
 * are expected and fine: fonts without colors, or a nav without a logo, each
 * improve the result on their own.
 */

// ─── color parsing ───────────────────────────────────────────────────────────

/** Clamp to a byte and format as 2-digit hex. */
function byte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg] ?? [0, 0, 0];
  return '#' + byte((r + m) * 255) + byte((g + m) * 255) + byte((b + m) * 255);
}

/**
 * oklch → sRGB. Worth carrying because Tailwind v4 and shadcn/ui emit oklch by
 * default, which makes it the palette format of exactly the recently-built
 * sites this feature is for. Returning null for it would silently opt every
 * modern customer out of color capture.
 */
function oklchToHex(L: number, C: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), bb = C * Math.sin(h);
  // Oklab → LMS
  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  // LMS → linear sRGB
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const enc = (v: number) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return byte(c * 255);
  };
  return '#' + enc(lr) + enc(lg) + enc(lb);
}

/** A number that may be written as a percentage of `full`. */
function num(tok: string, full = 1): number {
  const t = tok.trim();
  return t.endsWith('%') ? (parseFloat(t) / 100) * full : parseFloat(t);
}

/**
 * Normalize any CSS color a homepage is likely to contain to 6-digit hex.
 *
 * Includes the bare `"0 0% 100%"` triplet, which is not a CSS color at all —
 * it's the shadcn/ui convention, where the variable holds the components and
 * the consuming rule wraps them in `hsl(...)`. Sites built that way store every
 * color in that shape, so skipping it means capturing nothing from them.
 */
export function toHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase().replace(/;$/, '');
  if (!v || v === 'transparent' || v === 'inherit' || v === 'currentcolor' || v === 'none') return null;

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length <= 4) return '#' + h.slice(0, 3).split('').map((c) => c + c).join('');
    return '#' + h.slice(0, 6);
  }

  const rgb = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const p = rgb[1].split(/[,\/\s]+/).filter(Boolean);
    if (p.length < 3) return null;
    const [r, g, b] = p.slice(0, 3).map((x) => num(x, 255));
    if ([r, g, b].some(Number.isNaN)) return null;
    return '#' + byte(r) + byte(g) + byte(b);
  }

  const hsl = v.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const p = hsl[1].split(/[,\/\s]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = parseFloat(p[0]), s = parseFloat(p[1]), l = parseFloat(p[2]);
    if ([h, s, l].some(Number.isNaN)) return null;
    return hslToHex(h, s, l);
  }

  const oklch = v.match(/^oklch\(([^)]+)\)$/);
  if (oklch) {
    const p = oklch[1].split(/[,\/\s]+/).filter(Boolean);
    if (p.length < 3) return null;
    const L = num(p[0]), C = parseFloat(p[1]), h = parseFloat(p[2]);
    if ([L, C, h].some(Number.isNaN)) return null;
    return oklchToHex(L, C, h);
  }

  // shadcn/ui component triplet: "0 0% 100%" / "222.2 47.4% 11.2%"
  const triplet = v.match(/^(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/);
  if (triplet) return hslToHex(parseFloat(triplet[1]), parseFloat(triplet[2]), parseFloat(triplet[3]));

  const named: Record<string, string> = {
    white: '#ffffff', black: '#000000', red: '#ff0000', blue: '#0000ff',
    green: '#008000', gray: '#808080', grey: '#808080',
  };
  return named[v] ?? null;
}

// ─── types ───────────────────────────────────────────────────────────────────

export type NavLink = { label: string; href: string };

export type SiteDesign = {
  nav: {
    brand: { text: string | null; logo: string | null; href: string };
    links: NavLink[];
    cta: NavLink | null;
  } | null;
  fonts: {
    body: string | null;
    heading: string | null;
    /** Provider stylesheets to re-link verbatim (Google Fonts and friends). */
    stylesheets: string[];
  };
  colors: {
    bg: string | null;
    ink: string | null;
  };
  radius: number | null;
};

export const EMPTY_DESIGN: SiteDesign = {
  nav: null,
  fonts: { body: null, heading: null, stylesheets: [] },
  colors: { bg: null, ink: null },
  radius: null,
};

// ─── fonts ───────────────────────────────────────────────────────────────────

/**
 * Font stylesheets we are willing to re-link from a page grove serves.
 *
 * Restricted to dedicated font CDNs on purpose. Re-linking a customer's own
 * bundle would drag their entire site CSS onto the blog and fight every rule
 * grove ships; these hosts serve nothing but @font-face, and are CORS-open by
 * design, which self-hosted font files usually are not.
 */
const FONT_CDNS = [
  'fonts.googleapis.com',
  'fonts.bunny.net',
  'use.typekit.net',
  'p.typekit.net',
  'api.fontshare.com',
  'cdn.jsdelivr.net',
  'use.fontawesome.com',
  'fonts.cdnfonts.com',
];

/** A family name so generic that copying it tells us nothing about the brand. */
const GENERIC_FONT = /^(inherit|initial|unset|revert|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont)$/i;

/**
 * Fonts a Next.js site self-hosts through `next/font` get a hashed family name
 * (`__Inter_e8ce0c`) bound to files on THEIR origin. The name is meaningless
 * anywhere else, so capturing it would set a font-family that resolves to
 * nothing and silently drop the page to a system fallback.
 */
const HASHED_FONT = /^__|_[0-9a-f]{6}$/;

export function extractFontStylesheets(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?[^"'>]*stylesheet/i.test(tag)) continue;
    // Entity-decoded: an href is HTML, so a Google Fonts URL arrives as
    // `family=Inter&amp;display=swap`. Re-linking that verbatim requests a
    // parameter literally named `amp;display` and the weights come back wrong.
    const href = decodeEntities(tag.match(/href=["']([^"']+)["']/i)?.[1] ?? '');
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol !== 'https:') continue;
      if (!FONT_CDNS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) continue;
      // jsdelivr and friends serve everything; only take the font packages.
      if (url.hostname === 'cdn.jsdelivr.net' && !/fontsource|font/i.test(url.pathname)) continue;
      if (!out.includes(url.toString())) out.push(url.toString());
    } catch { /* unparseable href */ }
    if (out.length >= 6) break;
  }
  return out;
}

/** First usable family from a `font-family` declaration value. */
function firstFamily(value: string | undefined): string | null {
  if (!value) return null;
  for (const raw of value.split(',')) {
    const fam = raw.trim().replace(/^['"]|['"]$/g, '').replace(/\s*!important$/i, '').trim();
    if (!fam || GENERIC_FONT.test(fam) || HASHED_FONT.test(fam)) continue;
    if (fam.startsWith('var(')) continue;
    return fam;
  }
  return null;
}

/**
 * The whole `font-family` stack, minus the parts that cannot travel — so the
 * blog keeps the customer's fallback chain rather than jumping straight to a
 * system default when the primary face fails to load.
 */
function familyStack(value: string | undefined): string | null {
  if (!value) return null;
  const kept = value
    .split(',')
    .map((r) => r.trim().replace(/\s*!important$/i, '').trim())
    .filter((f) => f && !f.startsWith('var(') && !HASHED_FONT.test(f.replace(/^['"]|['"]$/g, '')));
  if (!kept.length) return null;
  if (kept.every((f) => GENERIC_FONT.test(f.replace(/^['"]|['"]$/g, '')))) return null;
  return kept.join(', ');
}

export function extractFonts(html: string, css: string, baseUrl: string): SiteDesign['fonts'] {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + '\n' + css;
  const props = customProps(style);
  const family = (rule: string | null | undefined) =>
    resolveVars(rule?.match(/font-family\s*:\s*([^;}]+)/i)?.[1], props);

  // Same precedence as the palette: the shell element that actually wraps the
  // page beats `body`, which sites often leave on a default they then override.
  const shellFamily = family(shellRule(html, style));
  const bodyFamily = family(style.match(/(?:^|[},])\s*(?:html\s*,\s*body|body|html)\s*\{([^}]*)\}/i)?.[1]);

  const headingRule = style.match(/(?:^|[},])\s*[^{}]*\bh[123]\b[^{}]*\{([^}]*font-family[^}]*)\}/i)?.[1];
  const headingFamily = family(headingRule);

  // A --font-* custom property is how next/font and most design systems expose
  // the real family; the literal inside it survives even when the class that
  // consumes it does not.
  const varFamily = resolveVars(style.match(/--font[-\w]*\s*:\s*([^;}]+)/i)?.[1], props);

  return {
    body: familyStack(shellFamily) ?? familyStack(bodyFamily) ?? firstFamily(varFamily),
    heading: familyStack(headingFamily) ?? firstFamily(headingFamily),
    stylesheets: extractFontStylesheets(html, baseUrl),
  };
}

// ─── colors ──────────────────────────────────────────────────────────────────

/**
 * Every custom property the stylesheet declares, so `var()` references can be
 * resolved to real colors.
 *
 * FIRST definition wins, not last. A dark-mode block (`.dark{}`,
 * `@media (prefers-color-scheme: dark)`) redefines the same names further down
 * the file, and taking the last value would hand back the dark palette for a
 * site that is light by default — the `:root` declaration at the top is the
 * page as it actually loads.
 */
function customProps(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of style.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const key = m[1].trim();
    if (!map.has(key)) map.set(key, m[2].trim());
  }
  return map;
}

/**
 * Resolve `var(--x)` / `var(--x, fallback)`, following chains a few levels.
 *
 * Token-driven sites almost never write a literal where the color is used —
 * grove's own homepage says `body{background:var(--bone)}` — so without this,
 * capture returns nothing for exactly the well-built sites it should handle
 * best. Depth-limited because custom properties can reference each other in a
 * cycle and CSS is not a language we are obliged to fully evaluate.
 */
function resolveVars(value: string | undefined, props: Map<string, string>, depth = 0): string | undefined {
  if (!value || depth > 4 || !value.includes('var(')) return value;
  const replaced = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) =>
    props.get(name) ?? (fallback ?? '').trim()
  );
  return replaced === value ? value : resolveVars(replaced, props, depth + 1);
}

/**
 * The rule that paints the page, which is often not `body`.
 *
 * React and Next sites routinely leave `body` on a neutral default and put the
 * real surface on the shell element inside it — grove's own homepage is
 * `<body><div class="gv-land">`, where `.gv-land` carries
 * `background-color:#000` while `body` is still the light `--bone`. Reading
 * `body` there captures a palette no visitor ever sees.
 *
 * Only the first classed element under <body> is considered, and only when its
 * rule sets BOTH a background and a color — a content container usually sets
 * one or neither, so requiring the pair keeps this from latching onto a card.
 */
function shellRule(html: string, style: string): string | null {
  const bodyAt = html.search(/<body\b/i);
  if (bodyAt < 0) return null;
  const after = html.slice(bodyAt, bodyAt + 6000);
  for (const m of after.matchAll(/<(?:div|main|section)\b([^>]*)>/gi)) {
    const cls = m[1].match(/\bclass=["']([^"']+)["']/i)?.[1];
    if (!cls) continue; // wrapper with no class tells us nothing (e.g. Next's <div hidden>)
    for (const name of cls.trim().split(/\s+/).slice(0, 4)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rule = style.match(new RegExp(`\\.${esc}\\s*\\{([^}]*)\\}`, 'i'))?.[1];
      if (rule && /background(?:-color)?\s*:/i.test(rule) && /(?:^|[;{])\s*color\s*:/i.test(rule)) return rule;
    }
    return null; // only the outermost shell; deeper divs are page content
  }
  return null;
}

/** A background shorthand only yields a color when it IS one flat color. */
function flatBackground(value: string | undefined): string | null {
  if (!value) return null;
  if (/gradient|url\(/i.test(value)) return null;
  return toHex(value.trim().split(/\s+(?![^(]*\))/)[0]);
}

/**
 * Page background and body text color.
 *
 * Ordered by how close each source is to what a visitor actually sees: the
 * shell element that paints the page, then a `--background`/`--foreground`
 * pair (a design system stating its intent), then the `body` rule. When both
 * halves cannot be found the pair is dropped: a background captured without
 * its ink (or the reverse) produces black-on-black exactly as often as it
 * produces something readable.
 */
export function extractColors(html: string, css: string): SiteDesign['colors'] {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + '\n' + css;
  const props = customProps(style);

  const readRule = (rule: string | null | undefined) => {
    if (!rule) return { bg: null, ink: null };
    return {
      bg: flatBackground(resolveVars(rule.match(/background(?:-color)?\s*:\s*([^;}]+)/i)?.[1], props)),
      ink: toHex(resolveVars(rule.match(/(?:^|[;{])\s*color\s*:\s*([^;}]+)/i)?.[1], props)),
    };
  };

  const shell = readRule(shellRule(html, style));
  if (shell.bg && shell.ink) return shell;

  const prop = (names: string[]): string | null => {
    for (const n of names) {
      const hex = toHex(resolveVars(props.get(`--${n}`), props));
      if (hex) return hex;
    }
    return null;
  };

  const body = readRule(style.match(/(?:^|[},])\s*(?:html\s*,\s*body|body|html)\s*\{([^}]*)\}/i)?.[1]);
  const bg = prop(['background', 'bg', 'body-bg', 'page-bg', 'color-background', 'surface']) ?? body.bg;
  const ink = prop(['foreground', 'fg', 'text', 'body-color', 'color-text', 'ink']) ?? body.ink;

  // Both or neither — see above.
  return bg && ink ? { bg, ink } : { bg: null, ink: null };
}

// ─── navigation ──────────────────────────────────────────────────────────────

const NAV_SKIP = /^(skip to|menu|toggle|open|close|search|cart|#|javascript:)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Rebuild the site's primary navigation from its homepage header.
 *
 * A RECONSTRUCTION, not a copy: grove takes the labels, destinations and logo
 * and renders them with its own markup and the captured tokens. Replaying the
 * customer's raw HTML would need their CSS and their JS to look like anything,
 * and would drag their whole framework onto a page grove serves.
 *
 * Every href is absolutised against the homepage, which is the point on a
 * hosted blog: `blog.acme.com` rendering `/pricing` would link to a page that
 * does not exist there, silently breaking every nav item.
 */
export function extractNav(html: string, baseUrl: string): SiteDesign['nav'] {
  let home = '/';
  try { home = new URL(baseUrl).origin; } catch { /* keep '/' */ }

  const abs = (href: string): string | null => {
    try {
      const u = new URL(href, baseUrl);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch { return null; }
  };

  // Prefer <header>, then <nav>. Both are collected rather than taking the
  // first match, because the first <header> on a marketing site is often a
  // mega-menu wrapping forty links — measured on vercel.com, which yielded
  // "AI SDK | AI Gateway | Sandbox …" as though those were the top-level nav.
  // A real primary nav is a handful of items, so region choice is scored on
  // that shape below rather than on document order alone.
  const candidates = [
    ...[...html.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi)].map((m) => m[1]),
    // Non-semantic navs, which are common in JSX and are what grove's own
    // landing page ships: `<div className="gv-navlinks">` inside a plain
    // positioned div, with no <nav> anywhere on the page. Matched by class or
    // id and read as a bounded window, since a regex cannot find the matching
    // close tag of an arbitrary nested element. The nav-shape scoring below is
    // what keeps an over-long window from being accepted.
    ...[...html.matchAll(/<(?:div|ul)\b[^>]*(?:class|id)=["'][^"']*nav[^"']*["'][^>]*>/gi)]
      .slice(0, 4)
      .map((m) => html.slice(m.index! + m[0].length, m.index! + m[0].length + 2500)),
  ];

  const parsed: NonNullable<SiteDesign['nav']>[] = [];
  for (const region of candidates) {
    const links: NavLink[] = [];
    let cta: NavLink | null = null;
    let logo: string | null = null;
    let brandText: string | null = null;

    for (const m of region.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = m[1];
      const inner = m[2];
      const href = attrs.match(/href=["']([^"']*)["']/i)?.[1];
      if (!href) continue;
      const url = abs(href);
      if (!url) continue;

      // The logo link: an <img> where the label should be, or a link to home.
      const img = inner.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
      const label = textOf(inner);
      // The brand link is a bare link to the origin. An in-page anchor like
      // `#agents` also has an empty pathname, and taking it made grove's own
      // first nav item the wordmark — so a hash or a query disqualifies it.
      const isHome = (() => {
        try {
          const u = new URL(url);
          return u.pathname.replace(/\/$/, '') === '' && !u.hash && !u.search;
        } catch { return false; }
      })();

      if (img && !logo) {
        logo = abs(img);
        if (!brandText) brandText = decodeEntities(inner.match(/\balt=["']([^"']*)["']/i)?.[1] ?? '') || label || null;
        continue;
      }
      if (!label || NAV_SKIP.test(label) || label.length > 28) continue;
      if (isHome && !brandText && !links.length) { brandText = label; continue; }
      if (links.some((l) => l.label.toLowerCase() === label.toLowerCase())) continue;

      // A button-ish class marks the primary action; the last one wins, which
      // is where "Get started" sits in almost every header.
      if (/\b(btn|button|cta|primary|signup|sign-up|get-started)\b/i.test(attrs)) cta = { label, href: url };
      else links.push({ label, href: url });
      // Collect past the render cap so an oversized mega-menu is recognisable
      // as one; the winning region is trimmed to NAV_MAX below.
      if (links.length > 24) break;
    }

    if (links.length + (cta ? 1 : 0) >= 2) {
      parsed.push({ brand: { text: brandText, logo, href: home }, links, cta });
    }
  }
  if (!parsed.length) return null;

  // A primary nav is 2–8 items. Prefer the first region shaped like one; only
  // fall back to an oversized region (trimmed) when nothing else was found.
  const best = parsed.find((p) => p.links.length + (p.cta ? 1 : 0) <= 8) ?? parsed[0];
  return { ...best, links: best.links.slice(0, NAV_MAX) };
}

/** How many nav items the hosted blog will render before it stops. */
const NAV_MAX = 6;

// ─── radius ──────────────────────────────────────────────────────────────────

export function extractRadius(html: string, css: string): number | null {
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + '\n' + css;
  const declared = style.match(/--(?:radius|border-radius|rounded)[-\w]*\s*:\s*([\d.]+)(px|rem)/i);
  if (declared) {
    const n = parseFloat(declared[1]) * (declared[2].toLowerCase() === 'rem' ? 16 : 1);
    if (n >= 0 && n <= 28) return Math.round(n);
  }
  // Otherwise the most common non-pill radius the stylesheet actually uses.
  const counts = new Map<number, number>();
  for (const m of style.matchAll(/border-radius\s*:\s*([\d.]+)(px|rem)/gi)) {
    const n = parseFloat(m[1]) * (m[2].toLowerCase() === 'rem' ? 16 : 1);
    if (n <= 0 || n > 28) continue;
    counts.set(Math.round(n), (counts.get(Math.round(n)) ?? 0) + 1);
  }
  let best: number | null = null, bestN = 0;
  for (const [r, n] of counts) if (n > bestN) { bestN = n; best = r; }
  return best;
}

// ─── entry point ─────────────────────────────────────────────────────────────

/**
 * Everything above, over one homepage. Never throws and never returns a
 * partially-applied palette; an unparseable page yields EMPTY_DESIGN and the
 * hosted blog keeps grove's own look.
 */
export function extractSiteDesign(html: string, css = '', baseUrl = ''): SiteDesign {
  try {
    return {
      nav: extractNav(html, baseUrl),
      fonts: extractFonts(html, css, baseUrl),
      colors: extractColors(html, css),
      radius: extractRadius(html, css),
    };
  } catch {
    return EMPTY_DESIGN;
  }
}

/** True when there is enough here to be worth rendering differently. */
export function hasDesign(d: SiteDesign | null | undefined): boolean {
  if (!d) return false;
  return !!(d.nav || d.colors.bg || d.fonts.body || d.fonts.heading);
}

/**
 * Re-validate a stored stylesheet URL before it reaches a page grove serves.
 *
 * Extraction already filters to FONT_CDNS, but these values live in a JSON
 * column and were written by an earlier deploy — the render path must not
 * trust that the rules in force when a row was written are the rules now.
 */
export function isFontStylesheet(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return FONT_CDNS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

// ─── tokens for the hosted blog ──────────────────────────────────────────────

function rgbOf(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length === 3) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  if (h.length === 6) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  return null;
}

/** Blend two hex colors, `t` of the way from `a` to `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = rgbOf(a), y = rgbOf(b);
  if (!x || !y) return a;
  return '#' + (['r', 'g', 'b'] as const).map((k) => byte(x[k] + (y[k] - x[k]) * t)).join('');
}

function lum(hex: string): number {
  const c = rgbOf(hex);
  if (!c) return 1;
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/**
 * The captured palette, expanded into the tokens grove's blog stylesheet
 * already hangs off (--ink / --bone / --paper / --clay / --line).
 *
 * Same principle as the embed: derive RELATIONSHIPS to the site's own paper
 * and ink rather than pick values, so one formula serves a white site, a warm
 * one and a near-black one. Returns undefined when no palette was captured, so
 * the blog keeps grove's own look rather than a half-applied one.
 */
export function designTokens(d: SiteDesign | null | undefined): Record<string, string> | undefined {
  const bg = d?.colors.bg, ink = d?.colors.ink;
  if (!bg || !ink) return undefined;
  const dark = lum(bg) < 0.22;
  const out: Record<string, string> = {
    '--bone': bg,
    '--ink': ink,
    // Cards and the article body lift off the page — toward white on a light
    // site, toward the light end on a dark one.
    '--surface': mixHex(bg, '#ffffff', dark ? 0.07 : 0.6),
    '--paper': mixHex(bg, ink, 0.06),
    '--clay': mixHex(bg, ink, 0.55),
    '--line': mixHex(bg, ink, 0.14),
    // Code blocks: inverted on a light site (the familiar dark slab), recessed
    // on a dark one. Inverting a dark page instead puts a white block in the
    // middle of the article — the page background sits BELOW the lifted card,
    // so using it as the code surface reads as a well.
    '--code-bg': dark ? bg : ink,
    '--code-ink': dark ? ink : bg,
  };
  if (d?.radius != null) {
    out['--r-md'] = `${d.radius}px`;
    out['--r-lg'] = `${Math.round(d.radius * 1.3)}px`;
    out['--r-xl'] = `${Math.round(d.radius * 1.7)}px`;
  }
  return out;
}

/** CSS-safe font stack: quote families with spaces, drop anything exotic. */
function fontStack(stack: string | null, fallback: string): string {
  if (!stack) return fallback;
  const parts = stack
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    // A family name is letters, digits, spaces and hyphens. Anything else is
    // either a CSS function we can't resolve or an injection attempt — this
    // string is interpolated into a <style> tag.
    .filter((f) => f && /^[\w\s-]+$/.test(f))
    .map((f) => (/\s/.test(f) ? `'${f}'` : f));
  return parts.length ? parts.join(', ') + ', ' + fallback : fallback;
}

/**
 * The stylesheet a hosted blog page emits to look like the customer's site.
 *
 * Retints grove's tokens and — the other half of the complaint — replaces the
 * two typefaces that make a page unmistakably grove's: GT Walsheim on the big
 * title (`.display`) and DM Mono on every label (`.mono`). Those are grove's
 * brand, and shipping them on a customer's own subdomain is the typographic
 * version of shipping grove's green.
 */
export function designCss(d: SiteDesign | null | undefined): string | null {
  const tokens = designTokens(d);
  const body = d?.fonts.body ? fontStack(d.fonts.body, 'system-ui, sans-serif') : null;
  const heading = d?.fonts.heading ? fontStack(d.fonts.heading, 'system-ui, sans-serif') : body;
  if (!tokens && !body) return null;

  const rules: string[] = [];
  if (tokens) rules.push(`:root{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')}}`);
  if (tokens) rules.push('body{background:var(--bone);color:var(--ink)}');
  if (body) {
    rules.push(`body,.mono,input,button,textarea,select{font-family:${body}}`);
    // .mono is grove's DM Mono label idiom; on a customer's blog the labels
    // should be in the customer's own face.
    rules.push(`.mono{letter-spacing:0.02em}`);
  }
  if (heading) rules.push(`.display,h1,h2,h3,h4,.prose h1,.prose h2,.prose h3{font-family:${heading}}`);
  return rules.join('');
}
