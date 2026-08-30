import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Catch user-facing English that was never externalized.
 *
 * The coverage test (i18n-coverage) proves every string passed to `t` has a
 * Korean entry. It structurally CANNOT prove that a string reached `t` in the
 * first place — and 72 of them hadn't, which is why a Korean dashboard still
 * had English in it after the catalogue was reported complete. The rest of the
 * industry solves this with an ESLint rule (eslint-plugin-i18next's
 * `no-literal-string`). This repo has no ESLint config and deliberately few
 * dependencies, and its enforcement point is `npm test`, so the same rule lives
 * here instead.
 *
 * Scope: the customer-facing dashboard. `/dashboard/admin/*` and the marketing
 * pages are deliberately English (see CLAUDE.md) and are not scanned.
 */

const ENTITIES: Record<string, string> = {
  '&apos;': "'", '&rsquo;': '’', '&lsquo;': '‘', '&amp;': '&', '&nbsp;': ' ',
  '&quot;': '"', '&ldquo;': '“', '&rdquo;': '”', '&mdash;': '—', '&ndash;': '–',
  '&lt;': '<', '&gt;': '>',
};
/** JSX sources write `didn&apos;t`, so a raw-text scan has to decode first —
 *  this is why the first pass at this feature missed most of what it missed. */
const decode = (s: string) => s.replace(/&\w+;/g, (m) => ENTITIES[m] ?? m);

/**
 * Strings that are legitimately not translatable prose. Kept deliberately
 * short: every addition is a string a Korean user will read in English, so it
 * needs a reason that survives someone asking about it.
 */
const ALLOWED = [
  /^void \| Promise$/,                       // a TypeScript return type, not text
  /^sha256=HMAC/,                            // a literal header format
  /^owner\/repo/,                            // an input format example
  /^github_pat_/,                            // an input format example
  /^https?:\/\//,                            // URLs and URL examples
  /^[\w.-]+\.(com|io|ai|dev)\b/,             // hostname examples
];

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Prose = a run of lowercase letters and a space, and nothing that looks like
 * code. The code guard matters: `>` and `<` also delimit JSX expressions, so a
 * naive text scan reads `{list.map((m, i) => m.role === 'user' ? (` as a
 * sentence — and an automated fix then rewrites working code into a string.
 * That happened twice while writing this.
 */
const CODE = /=>|===|!==|&&|\|\||\?\.|\.\w+\(|\.(?:length|map|filter|slice)\b|\$\{/;
const isProse = (s: string) => /[a-z]{2}/.test(s) && /\s/.test(s) && !CODE.test(s);

type Finding = { file: string; text: string };

function unwrapped(): Finding[] {
  const found: Finding[] = [];
  const files = tsxFiles('app/dashboard').filter((p) => !p.includes(`${path.sep}admin${path.sep}`));
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const push = (raw: string) => {
      const text = decode(raw.trim());
      if (!isProse(text)) return;
      if (ALLOWED.some((re) => re.test(text))) return;
      found.push({ file, text });
    };
    // A JSX text node: `>  Some words here  <` with no braces inside, so
    // anything already wrapped in {t('…')} is skipped by construction.
    for (const m of src.matchAll(/>\s*([A-Za-z][^<>{}\n]{3,200}?)\s*</g)) push(m[1]);
    // User-facing attributes. A `{t('…')}` value starts with `{` and is skipped.
    for (const m of src.matchAll(/(?:placeholder|aria-label|title|alt)=(["'])([^"'{][^"']{3,200}?)\1/g)) push(m[2]);
  }
  return found;
}

describe('no unwrapped English in the customer dashboard', () => {
  it('every user-facing string goes through t()', () => {
    const found = unwrapped();
    const report = found
      .map((f) => `  ${f.file}\n      ${JSON.stringify(f.text)}`)
      .join('\n');
    expect(
      found,
      `${found.length} user-facing string(s) never reach the translator, so they ` +
        `render English in every locale:\n${report}\n\n` +
        `Wrap them in t('…'), or add a reason to ALLOWED in this file.`,
    ).toEqual([]);
  });

  it('the scanner itself still works', () => {
    // Guards against a regex change that silently makes this test vacuous.
    expect(isProse('Save the draft')).toBe(true);
    expect(isProse('SAVE')).toBe(false);
    expect(isProse('var(--gv-ink)')).toBe(false);
    expect(isProse("m.role === 'user' ? (")).toBe(false);   // code, not copy
    expect(isProse('results.length && (')).toBe(false);
    expect(decode('didn&apos;t')).toBe("didn't");
  });
});
