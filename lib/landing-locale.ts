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
 * `hreflang`, and both are in the sitemap. Detection still has a job — it just
 * isn't the mechanism. See `landingRedirect` below.
 *
 * ── Adding a language ─────────────────────────────────────────────────────
 * One entry here plus a COMPLETE catalogue. A half-translated landing is worse
 * than an English one: it gets indexed, and a searcher lands on a page that
 * switches language halfway down. That is why `es`/`zh` are absent even though
 * `lib/i18n` scaffolds them.
 */
// Both imports are middleware-safe: `./i18n/detect` has no dependencies at
// all, and `./seo` is already in the edge bundle for the blog-host rewrite.
// Importing `./i18n` here instead would drag all four catalogues in.
import type { LangCode } from './language';
import { pickAcceptLanguage } from './i18n/detect';
import { isBot } from './seo';

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

/**
 * Where a request for the English landing should be sent instead — or null to
 * serve it as asked. The one job detection has on this page.
 *
 * Deliberately conservative, because every rule here is a way to serve the
 * wrong page to someone who cannot tell you so:
 *
 *  - Only from `/`. A visitor who asked for `/ko` gets `/ko`, and one who asked
 *    for `/` in English after being redirected once gets `/` (they now have a
 *    cookie).
 *  - Never a bot. Googlebot must see the English landing at `/` and the Korean
 *    one at `/ko`, exactly as the hreflang pair claims. Redirecting a crawler
 *    by its headers is how a site ends up with one language indexed at both
 *    URLs, or neither indexed properly.
 *  - Never when `gv_lang` is set. That cookie is written when someone picks a
 *    language — in the nav switcher here, or on Brand voice in the dashboard —
 *    so it is a stated preference and outranks a browser default.
 *  - Only to a language the landing is actually translated into, which is why
 *    this takes LANDING_LOCALE_CODES rather than the four UI locales.
 *
 * The redirect writes no cookie: it stays a pure function of the request, so a
 * visitor who then picks English gets `/` from that point on, and one who never
 * picks anything keeps landing on Korean. Nothing to invalidate.
 */
export function landingRedirect(req: {
  path: string;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
  userAgent?: string | null;
}): string | null {
  if (req.path !== '/') return null;
  if (req.cookieLocale) return null;
  if (isBot(req.userAgent)) return null;

  const wanted = pickAcceptLanguage(req.acceptLanguage, LANDING_LOCALE_CODES);
  if (!wanted || wanted === 'en') return null;
  const to = landingPath(wanted);
  return to === '/' ? null : to;
}
