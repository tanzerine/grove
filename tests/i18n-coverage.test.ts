import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { KO } from '../lib/i18n/ko';
import { ES } from '../lib/i18n/es';
import { ZH } from '../lib/i18n/zh';
import { translate, coverage, createT, UI_LOCALES } from '../lib/i18n';
import { localeFromAcceptLanguage } from '../lib/i18n/server';

/**
 * The guarantee this file exists for: a `t('…')` added to the dashboard and
 * never translated is a Korean user staring at an English label, and nothing
 * else in the build would catch it. So the test reads the source, collects
 * every string actually passed to `t`, and holds the Korean catalogue to it.
 *
 * Korean is the language this feature shipped translated. Spanish and Chinese
 * are deliberately scaffolds — they are asserted to be VALID (no stray keys,
 * no empty values), not complete, because English fallback is a supported
 * state for them.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Every literal passed to t('…') across the app. */
function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const files = [
    ...sourceFiles('app'),
    ...sourceFiles('lib'),
    ...sourceFiles('components'),
  ];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // t('…') / t("…"), plus msg('…') for strings marked at their definition
    // site (module-level tables that cannot call `t`). First argument only.
    for (const m of src.matchAll(/(?<![\w.])(?:t|msg)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      const key = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (!used.has(key)) used.set(key, []);
      used.get(key)!.push(f);
    }
  }
  return used;
}

const USED = usedKeys();

describe('the extractor itself works', () => {
  it('finds the strings we know are wrapped', () => {
    expect(USED.size).toBeGreaterThan(150);
    expect(USED.has('Pipeline')).toBe(true);
    expect(USED.has('Log out')).toBe(true);
  });
});

describe('Korean covers every translated string', () => {
  it('has an entry for each t() key in the app', () => {
    const missing = [...USED.keys()].filter((k) => KO[k] === undefined);
    expect(
      missing,
      `${missing.length} string(s) reach a Korean user in English. Add them to lib/i18n/ko.ts:\n` +
        missing.map((k) => `  ${JSON.stringify(k)}: '',   // ${USED.get(k)![0]}`).join('\n'),
    ).toEqual([]);
  });

  it('never translates to an empty string', () => {
    const empty = Object.entries(KO).filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('keeps every {placeholder} the English source declares', () => {
    const holes = (s: string): string[] => (s.match(/\{(\w+)\}/g) ?? []).sort();
    const broken: string[] = [];
    for (const [source, ko] of Object.entries(KO)) {
      const a = holes(source), b = holes(ko);
      // A translation may DROP a placeholder deliberately (Korean often folds
      // "1 draft" into a bare noun) but must never INVENT one, which would
      // render a literal "{n}" to the user.
      for (const h of b) if (!a.includes(h)) broken.push(`${source} → ${ko} (unknown ${h})`);
    }
    expect(broken).toEqual([]);
  });

  it('has no entries for strings nothing uses', () => {
    // Stale keys are not a user-visible bug, but they are dead weight that
    // makes the catalogue look more complete than it is.
    const orphans = Object.keys(KO).filter((k) => !USED.has(k));
    expect(orphans, `stale keys in ko.ts:\n${orphans.join('\n')}`).toEqual([]);
  });
});

describe('the scaffold catalogues are valid, not complete', () => {
  for (const [name, dict] of [['es', ES], ['zh', ZH]] as [string, Record<string, string>][]) {
    it(`${name} has no stray or empty keys`, () => {
      const orphans: string[] = Object.keys(dict).filter((k) => !USED.has(k));
      expect(orphans, `keys in ${name}.ts that nothing uses`).toEqual([]);
      const empty: string[] = Object.values(dict).filter((v) => !v.trim());
      expect(empty).toEqual([]);
    });
  }

  it('reports its own incompleteness honestly to the switcher', () => {
    expect(coverage('en')).toBe(1);
    expect(coverage('ko')).toBeGreaterThan(0.9);
    expect(coverage('es')).toBeLessThan(0.6);   // shown as "partly translated"
  });
});

describe('translate', () => {
  it('falls back to the English source when a key is missing', () => {
    expect(translate('ko', 'a string nobody translated')).toBe('a string nobody translated');
    expect(translate('en', 'Pipeline')).toBe('Pipeline');
  });

  it('substitutes named placeholders', () => {
    expect(translate('en', '{n} drafts are ready for your review.', { n: 3 }))
      .toBe('3 drafts are ready for your review.');
    expect(translate('ko', '{n} drafts are ready for your review.', { n: 3 })).toContain('3');
  });

  it('leaves an unknown placeholder alone rather than printing "undefined"', () => {
    expect(translate('en', 'Hello {who}', { other: 'x' })).toBe('Hello {who}');
  });

  it('strips a |context qualifier when falling back', () => {
    // "Publishing" is a settings heading in one place and a status in another.
    expect(translate('es', 'Publishing|status')).toBe('Publishing');
    expect(translate('ko', 'Publishing|status')).not.toContain('|');
  });

  it('binds a locale and exposes it', () => {
    const t = createT('ko');
    expect(t.locale).toBe('ko');
    expect(t('Pipeline')).toBe(KO['Pipeline']);
    expect(createT('nonsense').locale).toBe('en');
  });
});

describe('Accept-Language', () => {
  it('picks the highest-q supported language', () => {
    expect(localeFromAcceptLanguage('ko-KR,ko;q=0.9,en;q=0.8')).toBe('ko');
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,es;q=0.5')).toBe('es');
  });

  it('returns null when nothing is supported, so the caller can default', () => {
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBe(null);
    expect(localeFromAcceptLanguage(null)).toBe(null);
    expect(localeFromAcceptLanguage('')).toBe(null);
  });
});

describe('every locale is selectable', () => {
  it('exposes exactly the four supported codes', () => {
    expect([...UI_LOCALES]).toEqual(['en', 'ko', 'es', 'zh']);
  });
});
