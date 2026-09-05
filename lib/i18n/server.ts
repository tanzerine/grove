/**
 * Server-side locale resolution for RSC pages and route handlers.
 *
 * ── One language per site, chosen on Brand voice ──────────────────────────
 * The first version of this made UI language a property of the PERSON (an
 * auth-metadata field plus a switcher in the account menu), separate from
 * `domains.language`. That was wrong in practice: an owner who set one site to
 * English, switched to another site, and found the dashboard still in Korean
 * has two controls disagreeing with each other and no way to tell which one
 * won. There is now one control — the picker on Brand voice — and it moves the
 * whole product.
 *
 * So the order is:
 *   1. the ACTIVE site's `language`. Switching sites switches the UI, because
 *      the switcher already does a full reload and every server component
 *      re-resolves this;
 *   2. the `gv_lang` cookie — written whenever the site's language is saved,
 *      and the only answer available before a site exists (onboarding);
 *   3. `Accept-Language`, so a first-time Korean visitor isn't made to hunt
 *      for a menu to read the page they just landed on;
 *   4. English.
 *
 * `cache()` makes the whole thing once per request, so the layout and every
 * page it renders share a single lookup.
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { supabaseServer } from '../supabase/server';
import { getActiveDomainFields } from '../active-domain';
import { normalizeLang, LANG_CODES } from '../language';
import { createT, UI_LANG_COOKIE, type T, type UiLocale } from './index';

const supported = (v: unknown): v is UiLocale =>
  typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);

/** First supported language in an Accept-Language header, or null. */
export function localeFromAcceptLanguage(header: string | null): UiLocale | null {
  if (!header) return null;
  const parts = header.split(',')
    .map((chunk) => {
      const [tag, ...params] = chunk.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of parts) {
    const base = tag.split('-')[0];
    if (supported(base)) return base;
  }
  return null;
}

export const getUiLocale = cache(async (): Promise<UiLocale> => {
  // 1. The site the owner is looking at. Best-effort: an unauthenticated
  //    request or a failing query must never take a page down over a label.
  try {
    const sb = await supabaseServer();
    const domain = await getActiveDomainFields(sb, 'id, verified_at, language');
    if (domain && supported(domain.language)) return domain.language;
  } catch { /* fall through */ }

  // 2. Last saved choice — also the only answer before any site exists.
  try {
    const cookieValue = (await cookies()).get(UI_LANG_COOKIE)?.value;
    if (supported(cookieValue)) return cookieValue;
  } catch { /* no cookie store in this context */ }

  // 3. What the browser asked for.
  try {
    const fromHeader = localeFromAcceptLanguage((await headers()).get('accept-language'));
    if (fromHeader) return fromHeader;
  } catch { /* no headers in this context */ }

  return 'en';
});

/** The bound translator for the current request. */
export async function getT(): Promise<T> {
  return createT(await getUiLocale());
}

/**
 * The locale for the surfaces that come BEFORE the dashboard — the auth form
 * and every onboarding step. Cookie → `Accept-Language` → English, and
 * deliberately NOT the active site's language.
 *
 * `getUiLocale()` reads the site first, which is right once someone is inside
 * the dashboard managing a specific blog. It is wrong here, and in a way that
 * is easy to ship by accident: onboarding is where the owner CHOOSES what the
 * site publishes in, so a Korean-speaking founder setting up an English blog
 * would watch the flow flip to English underneath them the moment the row was
 * written — mid-flow, with no control on screen to put it back.
 *
 * Before a site exists the two resolvers agree anyway (both fall through to the
 * cookie), so the only case this changes is the one it exists for: a returning
 * owner adding a second site.
 */
export const getPublicUiLocale = cache(async (): Promise<UiLocale> => {
  // The last language actually chosen — written by the settings API whenever a
  // site's language is saved, so a returning owner keeps the language they
  // picked even while adding a site that publishes in another one.
  try {
    const cookieValue = (await cookies()).get(UI_LANG_COOKIE)?.value;
    if (supported(cookieValue)) return cookieValue;
  } catch { /* no cookie store in this context */ }

  // A first-time visitor has no cookie and no site. This is the only signal
  // there is, and it is why a Korean sign-up reads Korean without anyone
  // hunting for a switcher.
  try {
    const fromHeader = localeFromAcceptLanguage((await headers()).get('accept-language'));
    if (fromHeader) return fromHeader;
  } catch { /* no headers in this context */ }

  return 'en';
});

/**
 * The locale for a request that already knows which site it is acting on —
 * an API route with a `domain` row in hand. Preferred over `getUiLocale()`
 * there: it needs no extra query and cannot disagree with the domain the
 * route is actually writing to.
 */
export function localeForDomain(domain: { language?: string | null } | null | undefined): UiLocale {
  return normalizeLang(domain?.language);
}
