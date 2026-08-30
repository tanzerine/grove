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

/** The cookie the switcher writes. Read by the server on every request. */
export const UI_LANG_COOKIE = 'gv_lang';

/** Where the choice is persisted so it follows the user across devices. */
export const UI_LANG_METADATA_KEY = 'ui_language';
