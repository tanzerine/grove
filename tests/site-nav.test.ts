/**
 * Grove's navigation has to be the same bar on every page grove serves.
 *
 * It was not. The landing built its bar inline, /blog hand-copied it under a
 * comment claiming it was the "same shape as the landing's", and the hosted
 * blog reconstructs one from the homepage capture. When the landing gained FAQ,
 * only the landing gained it — so following the landing's own Blog link landed
 * a reader on a nav one item shorter than the one they had just used, and the
 * hosted article advertised a hero button ("See how it works") where the bar
 * says "Get Started".
 *
 * Three renderings of one thing drift silently. These tests make them agree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_NAV_LINKS, siteNavHref } from '../components/SiteNav';
import { extractNav } from '../lib/site-design';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('one definition', () => {
  it('is the bar the landing shows', () => {
    expect(SITE_NAV_LINKS.map((l) => l.label)).toEqual(['Agents', 'Platform', 'Pricing', 'Blog', 'FAQ']);
  });

  it('points section links at the landing from another page, and in-page on it', () => {
    const agents = SITE_NAV_LINKS.find((l) => l.label === 'Agents')!;
    expect(siteNavHref(agents, true)).toBe('#agents');
    expect(siteNavHref(agents, false)).toBe('/#agents');
    // Blog is a real page either way.
    const blog = SITE_NAV_LINKS.find((l) => l.label === 'Blog')!;
    expect(siteNavHref(blog, true)).toBe('/blog');
    expect(siteNavHref(blog, false)).toBe('/blog');
  });

  it.each([
    ['components/Landing.tsx'],
    ['app/blog/page.tsx'],
  ])('%s renders SiteNav instead of its own copy', (path) => {
    const src = read(path);
    expect(src).toMatch(/<SiteNav\b/);
    // The tell of a hand-rolled copy is naming the whole SET of section
    // anchors. One on its own is ordinary page content — the landing's hero has
    // a "See how it works" button pointing at #agents — so the bound is on how
    // many distinct ones a file names, not on naming any.
    const named = new Set([...src.matchAll(/href=["']\/?#(agents|platform|pricing|faq)["']/g)].map((m) => m[1]));
    expect(named.size, `${path} names ${[...named].join(', ')} — a re-declared nav`).toBeLessThanOrEqual(1);
  });
});

describe('the capture agrees with the bar', () => {
  // The hosted blog is not a SiteNav consumer — it serves customers, whose nav
  // comes from their own site. For GROVE's blog the two must still match, and
  // the only way they can is if the capture reads grove's real bar.
  const landing = read('components/SiteNav.tsx');

  it('reads grove’s own markup back into the same five labels', () => {
    // The shape SiteNav renders, as a crawler sees it.
    const html =
      `<body><div class="gv-snav"><div class="gv-snav-in">` +
      `<a class="gv-snav-brand" href="/"><img src="/landing/grove-mark.png" alt=""/><span>Grove</span></a>` +
      `<div class="gv-snav-links">` +
      SITE_NAV_LINKS.map((l) => `<a class="gv-snav-link" href="${siteNavHref(l, false)}">${l.label}</a>`).join('') +
      `</div><a class="gv-snav-cta" href="/signup">Get Started</a></div></div>` +
      `<main><h1>Grow your search traffic</h1>` +
      `<a class="gv-btn" href="/signup">Get started</a>` +
      `<a class="gv-btn gv-ghost" href="#agents">See how it works</a></main></body>`;

    const nav = extractNav(html, 'https://trygroveai.com/')!;
    expect(nav.links.map((l) => l.label)).toEqual(SITE_NAV_LINKS.map((l) => l.label));
    expect(nav.brand.text).toBe('Grove');
    expect(nav.brand.logo).toBe('https://trygroveai.com/landing/grove-mark.png');
  });

  it('takes the CTA from the bar, not from the hero below it', () => {
    // The regression this encodes: the class-matched window is a fixed slice
    // forward, so on a short nav it used to run into the page and the last
    // button-ish link — a hero button — became the "primary action".
    const html =
      `<body><div class="site-nav"><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a>` +
      `<a class="btn" href="/signup">Get Started</a></div>` +
      `<section><a class="btn" href="/demo">Book a demo</a>` +
      `<a class="btn ghost" href="#how">See how it works</a></section></body>`;
    expect(extractNav(html, 'https://acme.com/')!.cta).toEqual({ label: 'Get Started', href: 'https://acme.com/signup' });
  });

  it('still finds a CTA that genuinely sits in the bar', () => {
    const html =
      `<body><nav><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a>` +
      `<a class="btn" href="/signup">Start free</a></nav></body>`;
    expect(extractNav(html, 'https://acme.com/')!.cta?.label).toBe('Start free');
  });

  it('keeps the bar’s own styling in one file', () => {
    // Two mounts of the same markup with different CSS is the drift again in
    // another form, so SiteNav carries its styles rather than depending on a
    // page-scoped rule (.gv-land .gv-navlink was exactly that).
    expect(landing).toContain('.gv-snav-link:hover');
    expect(landing).toContain('.gv-snav-cta');
  });
});
