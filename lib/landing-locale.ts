/**
 * Which languages the MARKETING LANDING exists in, and at what URL.
 *
 * ── Why the landing is path-based when nothing else is ────────────────────
 * Every other translated surface (auth, onboarding, dashboard) resolves its
 * language from the request and serves it at one URL. That is right for them:
 * they are behind a login or noindexed, so there is nothing to crawl and
 * nothing to share.
 *
 * The landing is the opposite case, and getting it wrong would be embarrassing
 * for a company that sells SEO. Vary the language on `Accept-Language` at `/`
 * and Googlebot — which crawls from US IPs sending `en` — only ever sees the
 * English copy. The Korean page would exist and be unfindable by search, which
 * is the one outcome this product is supposed to prevent. Sharing breaks the
 * same way: a link pasted into a Korean group chat renders in whatever language
 * each recipient's browser happens to ask for.
 *
 * So each language gets a real URL, the pair declare each other with
 * `hreflang`, and both are in the sitemap.
 *
 * ── No detection at all ───────────────────────────────────────────────────
 * `/` is the English landing for everyone. An earlier version 307'd a
 * first-time visitor with a Korean `Accept-Language` from `/` to `/ko` once,
 * in middleware, until `gv_lang` was set. That is gone: the product default is
 * English on every page until the visitor picks a language themselves, and
 * the nav switcher (`components/LangSwitch.tsx`) is how they do it. The
 * switcher writes `gv_lang`, so the choice carries into sign-up, onboarding
 * and the dashboard — but it is a choice, never an inference from a header.
 *
 * ── Adding a language ─────────────────────────────────────────────────────
 * One entry here plus a COMPLETE catalogue. A half-translated landing is worse
 * than an English one: it gets indexed, and a searcher lands on a page that
 * switches language halfway down. That is why `es`/`zh` are absent even though
 * `lib/i18n` scaffolds them.
 */
import type { LangCode } from './language';

export type LandingLocale = { locale: LangCode; path: string; nativeName: string };

/** English first — it is the default and the `x-default` target. */
export const LANDING_LOCALES: readonly LandingLocale[] = [
  { locale: 'en', path: '/', nativeName: 'EN' },
  { locale: 'ko', path: '/ko', nativeName: '한국어' },
];

export const LANDING_LOCALE_CODES: readonly LangCode[] = LANDING_LOCALES.map((l) => l.locale);

/** The URL the landing is served at in one language ('/' for anything unknown). */
export function landingPath(locale: string | null | undefined): string {
  return LANDING_LOCALES.find((l) => l.locale === locale)?.path ?? '/';
}

/**
 * `alternates.languages` for Next metadata: every translation, plus the
 * `x-default` Google uses for a searcher whose language matches none of them.
 */
export function landingAlternates(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { locale, path } of LANDING_LOCALES) out[locale] = path;
  out['x-default'] = landingPath('en');
  return out;
}
