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
 * Scope: everything a CUSTOMER reads — the dashboard, the auth form and every
 * onboarding step. `/dashboard/admin/*` (only the operator sees it) and the
 * marketing landing (a voice decision, see CLAUDE.md) are not scanned.
 *
 * Auth and onboarding were added to the scan when they were translated. They
 * are the first three minutes of the product, and leaving them out would have
 * meant the same slow rediscovery the dashboard already went through: the
 * guard has to cover a surface from the day it ships, because the catalogue
 * test below cannot see a string that never reached `t`.
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
  /^gv-[\w-]/,                               // className templates
  /^grove-[\w-]/,                            // className templates
  /^use (?:client|server)$/,
  /^void \| Promise$/,                       // a TypeScript return type, not text
  /^sha256=HMAC/,                            // a literal header format
  /^owner\/repo/,                            // an input format example
  /^github_pat_/,                            // an input format example
  /^https?:\/\//,                            // URLs and URL examples
  /^[\w.-]+\.(com|io|ai|dev)\b/,             // hostname examples
  // Product names on the MCP step's tabs. These label which tool's config
  // format the snippet below is in, so they have to match what the customer
  // sees in that tool's own UI — a translated "Claude Desktop" would be
  // looking for an app that doesn't exist under that name.
  /^(?:Claude Code|Cursor \/ Claude Desktop)$/,
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
 * code or CSS. The code guard matters: `>` and `<` also delimit JSX
 * expressions, so a naive text scan reads `{list.map((m, i) => m.role ===
 * 'user' ? (` as a sentence — and an automated fix then rewrites working code
 * into a string. That happened twice while writing this.
 */
const CSS = /\d+(?:\.\d+)?(?:px|rem|em|vw|vh|%|s|ms)\b|rgba?\(|var\(--|#[0-9a-fA-F]{3,8}\b|cubic-bezier|calc\(/;
const SOURCE = /\b(?:function|const|let|var|return|import|export|className|style|interface|type)\b|[(=]/;
const CODE = /=>|===|!==|&&|\|\||\?\.|\.\w+\(|\.(?:length|map|filter|slice)\b|\$\{/;
const isProse = (s: string) =>
  /[a-z]{2}/.test(s) && /\s/.test(s) && !CODE.test(s) && !CSS.test(s) && !SOURCE.test(s);

type Finding = { file: string; text: string };

/** Every customer-facing .tsx: the dashboard minus admin, onboarding, and the
 *  one shared component the auth routes render. */
function scanned(): string[] {
  return [
    ...tsxFiles('app/dashboard').filter((p) => !p.includes(`${path.sep}admin${path.sep}`)),
    ...tsxFiles('app/onboarding'),
    path.join('components', 'AuthForm.tsx'),
  ];
}

function unwrapped(): Finding[] {
  const found: Finding[] = [];
  const files = scanned();
  for (const file of files) {
    // Blank out everything already passed to t()/msg() so its CONTENT can't be
    // re-reported by the broader literal rules below.
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\b(?:t|msg)\(\s*(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, (m) => ' '.repeat(m.length));
    const push = (raw: string) => {
      const text = decode(raw.trim());
      if (text === 'X' || /^X[\s·—-]*$/.test(text)) return;   // an all-placeholder template
      if (!isProse(text)) return;
      if (ALLOWED.some((re) => re.test(text))) return;
      found.push({ file, text });
    };
    // A JSX text node. The closing delimiter is `<` OR `{`: a sentence that
    // runs into an expression — `>Tracked by Analytics · {g.note}` — is still
    // a sentence, and the first version of this rule required `<` and so
    // never saw one. Anything already inside {t('…')} was blanked above.
    for (const m of src.matchAll(/>\s*([A-Za-z][^<>{}\n]{3,200}?)\s*[<{]/g)) push(m[1]);
    // Template literals rendered straight into JSX: {`… ${x} …`}. These carry
    // most of the counted strings ("3 drafts", "Week 4 · August 2026") and
    // were entirely invisible to a text-node scan.
    for (const m of src.matchAll(/\{\s*`([^`\\]{4,200}?)`\s*\}/g)) push(m[1].replace(/\$\{[^}]*\}/g, 'X'));
    // Display strings in object literals: `label: 'Weekly'`, `unit: 'posts'`.
    for (const m of src.matchAll(/\b(?:label|title|unit|heading|caption|hint|desc|description|subtitle|cta|blurb|summary)\s*:\s*(['"])([^'"\\\n]{3,200}?)\1/g)) push(m[2]);
    for (const m of src.matchAll(/\b(?:label|title|unit|heading|caption|hint|desc|description|subtitle|cta|blurb|summary)\s*:\s*`([^`\\]{3,200}?)`/g)) push(m[1].replace(/\$\{[^}]*\}/g, 'X'));
    // User-facing attributes. Each quote style is matched separately so the
    // OTHER quote may appear inside the value: the first version of this
    // forbade both, and silently skipped every placeholder containing an
    // apostrophe — "What should the picture show? (blank = …you're in)" among
    // them. A checker that quietly matches nothing is worse than no checker.
    for (const m of src.matchAll(/(?:placeholder|aria-label|title|alt)="([^"{][^"]{2,200}?)"/g)) push(m[1]);
    for (const m of src.matchAll(/(?:placeholder|aria-label|title|alt)='([^'{][^']{2,200}?)'/g)) push(m[1]);
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

  it('actually scans the funnel, not just the dashboard', () => {
    // The scope is the point of this file, and it is one line away from
    // silently shrinking back to the dashboard.
    const files = scanned();
    expect(files).toContain(path.join('components', 'AuthForm.tsx'));
    expect(files).toContain(path.join('app', 'onboarding', 'verify', 'page.tsx'));
    expect(files.some((f) => f.includes(`${path.sep}admin${path.sep}`))).toBe(false);
  });

  it('the scanner itself still works', () => {
    // Guards against a regex change that silently makes this test vacuous.
    expect(isProse('Save the draft')).toBe(true);
    expect(isProse('SAVE')).toBe(false);
    expect(isProse('var(--gv-ink)')).toBe(false);
    expect(isProse("m.role === 'user' ? (")).toBe(false);   // code, not copy
    expect(isProse('results.length && (')).toBe(false);
    expect(decode('didn&apos;t')).toBe("didn't");
    // The regression that let real placeholders through: an apostrophe inside
    // a double-quoted attribute value.
    const withApostrophe = `placeholder="What should it show? (you're in)"`;
    expect([...withApostrophe.matchAll(/placeholder="([^"{][^"]{2,200}?)"/g)]).toHaveLength(1);
  });
});
