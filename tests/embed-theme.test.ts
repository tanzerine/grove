/**
 * public/embed.js is the one file that runs on domains we don't control, and it
 * has no DOM test harness (the suite is `environment: 'node'`). These tests
 * cover the two options grove's own site now depends on — `data-theme` and
 * `data-host` — by evaluating the small pure functions out of the source, plus
 * a contract on the stylesheet that a dark theme can't silently half-apply.
 *
 * Why the stylesheet contract matters: theming works only while EVERY surface
 * color resolves through a custom property. The moment someone adds
 * `background:#fff` to a new element, light mode still looks fine here and the
 * embed quietly ships a white block into a dark customer site.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(path.join(process.cwd(), 'public/embed.js'), 'utf8');

/** Pull a top-level function out of the IIFE and make it callable. */
function extract<T>(name: string, win: unknown): T {
  const m = SRC.match(new RegExp(`function ${name}\\(root\\) \\{[\\s\\S]*?\\n  \\}`));
  if (!m) throw new Error(`${name}() not found in embed.js`);
  return new Function('window', `${m[0]}; return ${name};`)(win) as T;
}

const el = (attrs: Record<string, string | null>) => ({
  getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
});

describe('data-host (pinned domain)', () => {
  const win = { location: { hostname: 'grove-a1b2c3.vercel.app' } };
  const hostFor = extract<(r: unknown) => string>('hostFor', win);

  it('auto-detects the live hostname when nothing is pinned', () => {
    expect(hostFor(el({}))).toBe('grove-a1b2c3.vercel.app');
    expect(hostFor(el({ 'data-host': '' }))).toBe('grove-a1b2c3.vercel.app');
    expect(hostFor(el({ 'data-host': '   ' }))).toBe('grove-a1b2c3.vercel.app');
  });

  it('prefers the pinned host — this is what makes previews and localhost work', () => {
    expect(hostFor(el({ 'data-host': 'trygroveai.com' }))).toBe('trygroveai.com');
  });

  it('tolerates a pasted URL rather than a bare hostname', () => {
    expect(hostFor(el({ 'data-host': 'https://trygroveai.com' }))).toBe('trygroveai.com');
    expect(hostFor(el({ 'data-host': 'https://trygroveai.com/blog' }))).toBe('trygroveai.com');
    expect(hostFor(el({ 'data-host': 'http://www.oveners.com/' }))).toBe('www.oveners.com');
  });
});

describe('data-theme', () => {
  const themeClass = extract<(r: unknown) => string>('themeClass', {});

  it('defaults to light — an existing customer sees no change', () => {
    expect(themeClass(el({}))).toBe('');
    expect(themeClass(el({ 'data-theme': 'light' }))).toBe('');
    expect(themeClass(el({ 'data-theme': 'nonsense' }))).toBe('');
  });

  it('maps dark and auto to their own root classes', () => {
    expect(themeClass(el({ 'data-theme': 'dark' }))).toBe(' gv-dark');
    expect(themeClass(el({ 'data-theme': 'DARK' }))).toBe(' gv-dark');
    expect(themeClass(el({ 'data-theme': 'auto' }))).toBe(' gv-auto');
  });

  it('is applied by every mount mode, not just the full blog', () => {
    // All three mounts must set the root class through themeClass(); a bare
    // `className = 'gv'` anywhere drops the theme for that mode.
    expect(SRC.match(/className = 'gv'(?!\s*\+)/g)).toBeNull();
    expect(SRC.match(/className = 'gv' \+ themeClass\(root\)/g)).toHaveLength(3);
  });
});

describe('stylesheet theming contract', () => {
  // The base rule is built by concatenation ('.gv{--gv-accent:' + accent + …),
  // so take the whole source line rather than one quoted literal.
  const base = SRC.split('\n').find((l) => l.includes("'.gv{"))!;
  const dark = SRC.match(/var DARK_VARS = '([^']*)'/)![1];

  const props = (css: string) =>
    new Set((css.match(/--gv-[a-z-]+(?=\s*:)/g) ?? []).map((p) => p.trim()));

  it('keeps the original light values as the default', () => {
    expect(base).toContain('--gv-surface:#fff');
    expect(base).toContain('--gv-line:#e6e2d6');
    expect(base).toContain('--gv-ink:#1a2e1f');
    expect(base).toContain('--gv-muted:#7a8a7d');
  });

  it('overrides every themable property in dark — none stays light by accident', () => {
    const themable = props(base);
    themable.delete('--gv-accent'); // branding, not theme: comes from the API
    for (const p of themable) expect(dark, `dark theme is missing ${p}`).toContain(`${p}:`);
  });

  it('routes every surface color through a custom property', () => {
    // Only the base rule may name a literal surface color.
    const rules = (SRC.match(/'\.gv[^']*\{[^']*\}'/g) ?? []).filter((r) => !r.startsWith("'.gv{"));
    const literal = rules.filter((r) => /background(-color)?:\s*(#fff|#ffffff|white)\b/i.test(r));
    expect(literal, `hardcoded surface color in: ${literal.join(' ')}`).toEqual([]);
  });

  it('gives accent-filled elements a readable foreground on both themes', () => {
    // Lime-on-white is grove's own accent; #fff text on it is unreadable.
    expect(base).toContain('--gv-on-accent:#fff');
    expect(dark).toContain('--gv-on-accent:');
    expect(SRC).toContain('.gv-chip.on{background:var(--gv-accent);color:var(--gv-on-accent)');
    expect(SRC).toContain('background:var(--gv-accent);color:var(--gv-on-accent)">★ Featured');
  });
});
