/**
 * Capturing a customer's design from their homepage — the hosted-blog half of
 * design inheritance.
 *
 * A blog grove serves on `blog.acme.com` has no page to measure, so it renders
 * from this capture instead. The failure that matters most here is not "missed
 * a font" but "applied half a palette": a background without its ink is how a
 * working blog turns into black-on-black, and unlike a missed capture it does
 * not degrade to grove's own look — it degrades to unreadable. Most of what
 * follows pins that down.
 *
 * Fixtures are the shapes real sites actually emit: shadcn/ui HSL triplets,
 * Tailwind v4 oklch, next/font hashed families, and a mega-menu header.
 */
import { describe, it, expect } from 'vitest';
import {
  toHex, extractColors, extractFonts, extractNav, extractRadius,
  extractSiteDesign, extractFontStylesheets, isFontStylesheet,
  designTokens, designCss, hasDesign, EMPTY_DESIGN,
} from '../lib/site-design';

const BASE = 'https://acme.com/';

describe('toHex', () => {
  it('reads the formats a homepage stylesheet actually contains', () => {
    expect(toHex('#f6f7f9')).toBe('#f6f7f9');
    expect(toHex('#ABC')).toBe('#aabbcc');
    expect(toHex('rgb(11, 13, 16)')).toBe('#0b0d10');
    expect(toHex('rgba(255,255,255,0.5)')).toBe('#ffffff');
    expect(toHex('hsl(210, 40%, 98%)')).toBe('#f8fafc'); // tailwind slate-50
    expect(toHex('white')).toBe('#ffffff');
  });

  it('reads a bare shadcn/ui triplet, which is not a CSS color at all', () => {
    // `--background: 0 0% 100%` — the variable holds components and the rule
    // wraps them in hsl(). Sites built this way store EVERY color like this,
    // so skipping the shape means capturing nothing from them.
    expect(toHex('0 0% 100%')).toBe('#ffffff');
    expect(toHex('222.2 47.4% 11.2%')).toBe('#0f172a');
  });

  it('reads oklch, which Tailwind v4 emits by default', () => {
    expect(toHex('oklch(1 0 0)')).toBe('#ffffff');
    expect(toHex('oklch(0 0 0)')).toBe('#000000');
    // A mid-tone stays in gamut and round-trips to something plausible.
    const blue = toHex('oklch(0.55 0.18 260)');
    expect(blue).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null rather than a wrong color', () => {
    for (const v of ['', 'transparent', 'inherit', 'currentColor', 'var(--x)', 'nonsense', null, undefined]) {
      expect(toHex(v), `parsed ${v}`).toBeNull();
    }
  });
});

describe('extractColors', () => {
  it('prefers a design system’s declared pair over a body rule', () => {
    const css = `:root{--background:#101014;--foreground:#eeeeee}body{background:#ffffff;color:#000000}`;
    expect(extractColors('', css)).toEqual({ bg: '#101014', ink: '#eeeeee' });
  });

  it('falls back to the body rule', () => {
    expect(extractColors('', `body { background: #f6f7f9; color: #0b0b0e; }`))
      .toEqual({ bg: '#f6f7f9', ink: '#0b0b0e' });
  });

  it('reads an html,body rule and a background-color longhand', () => {
    expect(extractColors('', `html,body{background-color:#fafafa;color:rgb(20,20,20)}`))
      .toEqual({ bg: '#fafafa', ink: '#141414' });
  });

  it('takes colors out of an inline <style> block too', () => {
    expect(extractColors('<style>body{background:#222;color:#eee}</style>', ''))
      .toEqual({ bg: '#222222', ink: '#eeeeee' });
  });

  it('returns NEITHER when it can only find one of the pair', () => {
    // The load-bearing case. A background applied without its ink leaves
    // grove's #1a2e1f green text on a customer's near-black page.
    expect(extractColors('', `body{background:#0b0d10}`)).toEqual({ bg: null, ink: null });
    expect(extractColors('', `body{color:#e8ecf1}`)).toEqual({ bg: null, ink: null });
  });

  it('ignores a background it cannot resolve to a flat color', () => {
    expect(extractColors('', `body{background:linear-gradient(#fff,#000);color:#111}`))
      .toEqual({ bg: null, ink: null });
  });
});

describe('extractFonts', () => {
  it('keeps the whole stack, not just the first family', () => {
    const f = extractFonts('', `body{font-family:Inter, ui-sans-serif, system-ui, sans-serif}`, BASE);
    expect(f.body).toBe('Inter, ui-sans-serif, system-ui, sans-serif');
  });

  it('takes headings from a heading rule, separately from body', () => {
    const css = `body{font-family:Inter,sans-serif}h1,h2,h3{font-family:'Fraunces',serif}`;
    const f = extractFonts('', css, BASE);
    expect(f.body).toBe('Inter, sans-serif');
    expect(f.heading).toBe("'Fraunces', serif");
  });

  it('drops a next/font hashed family, which means nothing off its origin', () => {
    // `__Inter_e8ce0c` is bound to @font-face rules on the customer's domain;
    // copying the name onto grove's page resolves to nothing.
    const f = extractFonts('', `body{font-family:__Inter_e8ce0c, __Inter_Fallback_e8ce0c, sans-serif}`, BASE);
    expect(f.body).toBeNull();
  });

  it('ignores a stack that is only generic families', () => {
    expect(extractFonts('', `body{font-family:system-ui, sans-serif}`, BASE).body).toBeNull();
  });
});

describe('extractFontStylesheets', () => {
  const link = (href: string) => `<link rel="stylesheet" href="${href}">`;

  it('takes font CDNs and leaves the customer’s own bundle alone', () => {
    const html =
      link('https://fonts.googleapis.com/css2?family=Inter&display=swap') +
      link('/_next/static/css/app.css') +
      link('https://acme.com/styles/site.css');
    // Re-linking their bundle would drag their whole site CSS onto a page
    // grove serves and fight every rule grove ships.
    expect(extractFontStylesheets(html, BASE)).toEqual([
      'https://fonts.googleapis.com/css2?family=Inter&display=swap',
    ]);
  });

  it('decodes entities in the href', () => {
    // An href is HTML: Google Fonts arrives as `family=Inter&amp;display=swap`,
    // and re-linking that verbatim requests a param named `amp;display`.
    const html = link('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap');
    expect(extractFontStylesheets(html, BASE)[0]).toContain('&display=swap');
    expect(extractFontStylesheets(html, BASE)[0]).not.toContain('amp;');
  });

  it('refuses non-https', () => {
    expect(extractFontStylesheets(link('http://fonts.googleapis.com/css2?family=Inter'), BASE)).toEqual([]);
  });
});

describe('isFontStylesheet — the render-time gate', () => {
  it('re-validates what the column claims', () => {
    // Values in site_profile.design were written by an earlier deploy; the
    // render path can't assume the rules then are the rules now.
    expect(isFontStylesheet('https://fonts.googleapis.com/css2?family=Inter')).toBe(true);
    expect(isFontStylesheet('https://fonts.bunny.net/css?family=inter')).toBe(true);
    expect(isFontStylesheet('https://evil.example.com/x.css')).toBe(false);
    expect(isFontStylesheet('http://fonts.googleapis.com/css2')).toBe(false);
    expect(isFontStylesheet('javascript:alert(1)')).toBe(false);
    expect(isFontStylesheet('not a url')).toBe(false);
  });
});

describe('extractNav', () => {
  const header = (inner: string) => `<header>${inner}</header>`;

  it('reconstructs brand, links and CTA with absolute hrefs', () => {
    const html = header(`
      <a href="/"><img src="/assets/logo.avif" alt="Acme"></a>
      <a href="/product">Product</a>
      <a href="/pricing">Pricing</a>
      <a class="btn-primary" href="/signup">Get started</a>
    `);
    const nav = extractNav(html, BASE)!;
    expect(nav.brand.logo).toBe('https://acme.com/assets/logo.avif');
    expect(nav.brand.text).toBe('Acme');
    expect(nav.links.map((l) => l.label)).toEqual(['Product', 'Pricing']);
    expect(nav.cta).toEqual({ label: 'Get started', href: 'https://acme.com/signup' });
  });

  it('absolutises every href — the whole point on a hosted blog', () => {
    // blog.acme.com rendering `/pricing` links to a page that does not exist
    // there, silently breaking every nav item.
    const nav = extractNav(header('<a href="/a">A</a><a href="/b">B</a>'), BASE)!;
    expect(nav.links.every((l) => l.href.startsWith('https://acme.com/'))).toBe(true);
  });

  it('uses a wordmark when the logo is an inline SVG', () => {
    const nav = extractNav(header('<a href="/">Acme</a><a href="/x">Docs</a><a href="/y">Blog</a>'), BASE)!;
    expect(nav.brand.text).toBe('Acme');
    expect(nav.links.map((l) => l.label)).toEqual(['Docs', 'Blog']);
  });

  it('skips a mega-menu header for a nav-shaped region', () => {
    // Measured on vercel.com, whose first <header> yielded "AI SDK | AI
    // Gateway | Sandbox …" as though those were the top-level nav.
    const mega = header(Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">Product ${i}</a>`).join(''));
    const real = `<nav><a href="/product">Product</a><a href="/pricing">Pricing</a><a href="/docs">Docs</a></nav>`;
    const nav = extractNav(mega + real, BASE)!;
    expect(nav.links.map((l) => l.label)).toEqual(['Product', 'Pricing', 'Docs']);
  });

  it('drops chrome that is not navigation', () => {
    const nav = extractNav(header(`
      <a href="#main">Skip to content</a>
      <a href="/product">Product</a>
      <a href="/pricing">Pricing</a>
      <a href="javascript:void(0)">Menu</a>
    `), BASE)!;
    expect(nav.links.map((l) => l.label)).toEqual(['Product', 'Pricing']);
  });

  it('deduplicates repeated labels (desktop + mobile markup)', () => {
    const nav = extractNav(header(`
      <a href="/product">Product</a><a href="/pricing">Pricing</a>
      <a href="/product">Product</a><a href="/pricing">Pricing</a>
    `), BASE)!;
    expect(nav.links).toHaveLength(2);
  });

  it('returns null when there is no nav to speak of', () => {
    expect(extractNav('<header><a href="/">Acme</a></header>', BASE)).toBeNull();
    expect(extractNav('<div>no header at all</div>', BASE)).toBeNull();
  });
});

describe('extractRadius', () => {
  it('prefers a declared radius token, in px or rem', () => {
    expect(extractRadius('', ':root{--radius:0.5rem}')).toBe(8);
    expect(extractRadius('', ':root{--radius:4px}')).toBe(4);
  });

  it('otherwise takes the most common non-pill radius', () => {
    expect(extractRadius('', '.a{border-radius:12px}.b{border-radius:12px}.c{border-radius:4px}.d{border-radius:999px}')).toBe(12);
  });

  it('returns null when there is nothing to copy', () => {
    expect(extractRadius('', '.a{border-radius:0}.b{border-radius:9999px}')).toBeNull();
  });
});

describe('designTokens', () => {
  const design = { ...EMPTY_DESIGN, colors: { bg: '#f6f7f9', ink: '#0b0b0e' }, radius: 8 };

  it('expands a captured pair into the tokens grove’s blog already reads', () => {
    const t = designTokens(design)!;
    expect(t['--bone']).toBe('#f6f7f9');
    expect(t['--ink']).toBe('#0b0b0e');
    expect(t['--r-md']).toBe('8px');
    for (const k of ['--surface', '--paper', '--clay', '--line']) expect(t[k]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('lifts the article surface off the page on light and dark alike', () => {
    const light = designTokens(design)!['--surface'];
    const dark = designTokens({ ...design, colors: { bg: '#0b0d10', ink: '#e8ecf1' } })!['--surface'];
    expect(light).not.toBe('#f6f7f9');
    expect(dark).not.toBe('#0b0d10');
  });

  it('gives nothing at all without a full pair', () => {
    expect(designTokens({ ...EMPTY_DESIGN, colors: { bg: '#fff', ink: null } })).toBeUndefined();
    expect(designTokens(null)).toBeUndefined();
  });
});

describe('designCss', () => {
  it('replaces the two typefaces that make a page unmistakably grove’s', () => {
    // GT Walsheim on .display and DM Mono on .mono are grove's brand; shipping
    // them on a customer's own subdomain is the typographic version of
    // shipping grove's green.
    const css = designCss({
      ...EMPTY_DESIGN,
      fonts: { body: 'Inter, sans-serif', heading: 'Fraunces, serif', stylesheets: [] },
    })!;
    expect(css).toContain('.mono');
    expect(css).toContain('.display');
    expect(css).toContain('Fraunces');
    expect(css).toContain('Inter');
  });

  it('cannot be used to inject into the style tag it is interpolated into', () => {
    const css = designCss({
      ...EMPTY_DESIGN,
      fonts: { body: 'Evil</style><script>alert(1)</script>', heading: null, stylesheets: [] },
    });
    expect(css ?? '').not.toContain('<script');
    expect(css ?? '').not.toContain('</style');
  });

  it('is null when there is nothing captured, so the blog keeps grove’s look', () => {
    expect(designCss(EMPTY_DESIGN)).toBeNull();
    expect(designCss(null)).toBeNull();
  });
});

describe('extractSiteDesign', () => {
  it('never throws, whatever it is handed', () => {
    for (const html of ['', '<html', '<<<>>>', '<header><a href="::::">x</a></header>']) {
      expect(() => extractSiteDesign(html, '', BASE)).not.toThrow();
    }
  });

  it('a page it cannot read leaves the blog looking like grove', () => {
    const d = extractSiteDesign('<p>hello</p>', '', BASE);
    expect(hasDesign(d)).toBe(false);
    expect(designCss(d)).toBeNull();
  });

  it('captures a whole ordinary marketing homepage', () => {
    // Shaped after the real oveners.com capture.
    const html = `
      <head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap"></head>
      <header>
        <a href="/"><img src="/assets/logo.avif" alt="Oven AI"></a>
        <a href="/generate">Generate</a><a href="/library">Library</a>
        <a href="/pricing">Pricing</a><a class="btn" href="/signup">Start free</a>
      </header>`;
    const css = `:root{--radius:8px}body{background:#f6f7f9;color:#0b0b0e;font-family:Inter, sans-serif}`;
    const d = extractSiteDesign(html, css, BASE);
    expect(hasDesign(d)).toBe(true);
    expect(d.colors).toEqual({ bg: '#f6f7f9', ink: '#0b0b0e' });
    expect(d.radius).toBe(8);
    expect(d.nav!.brand.text).toBe('Oven AI');
    expect(d.nav!.links.map((l) => l.label)).toEqual(['Generate', 'Library', 'Pricing']);
    expect(d.nav!.cta!.label).toBe('Start free');
    expect(d.fonts.stylesheets).toHaveLength(1);
  });
});
