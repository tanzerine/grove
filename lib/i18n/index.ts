/**
 * UI language — the language the OWNER controls grove in.
 *
 * Deliberately separate from `domains.language`, which is the language a blog
 * PUBLISHES in. They answer different questions and routinely disagree: a
 * Korean founder selling to Americans runs an English blog from a Korean
 * dashboard, and the reverse happens just as often. Publication language is a
 * property of a site; UI language is a property of a person.
 *
 * ── English is the key ────────────────────────────────────────────────────
 * `t('Waiting on you')` looks its argument up in the locale's catalogue and
 * returns the English source when there is no entry. That choice buys three
 * things worth more than tidy key names:
 *   - conversion is a mechanical wrap, with no key to invent or mistype;
 *   - there is no `en` catalogue to maintain and no way for it to drift;
 *   - a missing or half-finished translation renders English rather than
 *     `dashboard.pipeline.header.title`, so shipping a partial catalogue is
 *     safe. That is exactly the state es/zh are in.
 *
 * Placeholders are `{named}` and substituted by `t`'s second argument, so a
 * translation can move them: English "{n} waiting on you" is Korean
 * "검토 대기 {n}건".
 *
 * One English string sometimes needs two translations — "Publishing" is a
 * settings heading in one place and a post status in another, and Korean does
 * not use the same word for both. `t('Publishing|status')` disambiguates: the
 * catalogue keys on the whole string, and an untranslated locale renders only
 * the part before the `|`, so the qualifier never reaches a reader.
 */
import { LANG_CODES, LANGUAGES, normalizeLang, type LangCode } from '../language';
import { KO } from './ko';
import { ES } from './es';
import { ZH } from './zh';

/** UI locales are the same four codes as publication languages. */
export type UiLocale = LangCode;
export const UI_LOCALES = LANG_CODES;

export type Catalog = Record<string, string>;

/** No `en` entry: English source strings are the keys. */
const CATALOGS: Partial<Record<UiLocale, Catalog>> = { ko: KO, es: ES, zh: ZH };

export type Vars = Record<string, string | number>;

/** A bound translator. `t.locale` is exposed for date/number formatting. */
export type T = ((source: string, vars?: Vars) => string) & { locale: UiLocale };

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

/**
 * Translate one source string. Exported for tests and for the rare caller that
 * has a locale but no bound `t` — everything else uses `createT`.
 */
export function translate(locale: UiLocale, source: string, vars?: Vars): string {
  const dict = CATALOGS[normalizeLang(locale)];
  const hit = dict?.[source];
  if (hit !== undefined) return interpolate(hit, vars);
  // No entry: fall back to the bare English, minus any `|context` qualifier.
  const bar = source.indexOf('|');
  return interpolate(bar === -1 ? source : source.slice(0, bar), vars);
}

/**
 * Mark a string for translation where it is DEFINED rather than rendered.
 *
 * Module-level tables — status maps, upsell copy, prompt chips — can't call
 * `t`: they are built once per process, so they would freeze whichever locale
 * loaded the module first. They hold English source strings instead, and the
 * render site puts them through `t`. That leaves the string invisible to the
 * extractor in tests/i18n-coverage.test.ts, which is how an untranslated
 * label would slip past the one check that guards this whole feature.
 *
 * `msg` is the identity function. Its only job is to be greppable.
 */
export const msg = (source: string): string => source;

/**
 * Mark a string as DELIBERATELY untranslated sample content.
 *
 * The landing's product mockups are full of a fictional customer's own
 * material: article titles, target keywords, their hostname, their content
 * pillars. None of it should be translated — grove does not translate its
 * customers' articles, and the mockup sits beside PNG screenshots of the real
 * English product that cannot be translated either. A Korean visitor sees the
 * chrome in Korean and one English customer's blog inside it, which is exactly
 * what a Korean owner running an English site sees in the real dashboard.
 *
 * `sample` is the identity function, the mirror image of `msg`: `msg` says
 * "English now, translated at the render site", `sample` says "English on
 * purpose, forever". Making that explicit is what lets tests/i18n-unwrapped
 * scan this file at all — without it the scanner reports forty article titles
 * and the real finding is lost in them.
 */
export const sample = (source: string): string => source;

export function createT(locale: unknown): T {
  const code = normalizeLang(locale);
  const t = ((source: string, vars?: Vars) => translate(code, source, vars)) as T;
  t.locale = code;
  return t;
}

/** Intl locale for dates and numbers ('ko' → 'ko-KR'). */
export function intlLocale(locale: UiLocale): string {
  return LANGUAGES[normalizeLang(locale)].locale;
}

/** Endonym for the switcher ('한국어'), never the English name. */
export function localeName(locale: UiLocale): string {
  return LANGUAGES[normalizeLang(locale)].nativeName;
}

/**
 * How complete a catalogue is, as a fraction of the English strings the
 * fullest catalogue covers. Surfaced on the switcher so nobody picks a locale
 * expecting a finished translation — es and zh are scaffolds today.
 */
export function coverage(locale: UiLocale): number {
  if (normalizeLang(locale) === 'en') return 1;
  const dict = CATALOGS[normalizeLang(locale)];
  const widest = Math.max(...Object.values(CATALOGS).map((c) => Object.keys(c ?? {}).length), 1);
  return Math.min(1, Object.keys(dict ?? {}).length / widest);
}

/** The cookie the switcher writes. Read by the server on every request.
 *  Defined in ./detect (which imports nothing) so middleware can read the
 *  name without pulling the catalogues into the edge bundle. */
export { UI_LANG_COOKIE } from './detect';

/** Where the choice is persisted so it follows the user across devices. */
export const UI_LANG_METADATA_KEY = 'ui_language';
