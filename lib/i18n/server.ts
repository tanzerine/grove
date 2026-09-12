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
 *   3. English.
 *
 * ── English until told otherwise ──────────────────────────────────────────
 * There is deliberately no `Accept-Language` step. An earlier version put one
 * between the cookie and the default, so a Korean browser got a Korean sign-up
 * without hunting for a switcher. The product decision now is the opposite:
 * every page renders in English until the visitor CHOOSES a language — in the
 * landing's switcher or on Brand voice — and a browser header is not a choice.
 * The two signals this reads are both things someone set on purpose.
 *
 * `cache()` makes the whole thing once per request, so the layout and every
 * page it renders share a single lookup.
 */
import { cookies } from 'next/headers';
import { cache } from 'react';
import { supabaseServer } from '../supabase/server';
import { getActiveDomainFields } from '../active-domain';
import { normalizeLang, LANG_CODES } from '../language';
import { createT, UI_LANG_COOKIE, type T, type UiLocale } from './index';

const supported = (v: unknown): v is UiLocale =>
  typeof v === 'string' && (LANG_CODES as readonly string[]).includes(v);

/** The `gv_lang` cookie's value when it holds a supported language, else null. */
async function chosenLocale(): Promise<UiLocale | null> {
  try {
    const cookieValue = (await cookies()).get(UI_LANG_COOKIE)?.value;
    if (supported(cookieValue)) return cookieValue;
  } catch { /* no cookie store in this context */ }
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
  return (await chosenLocale()) ?? 'en';
});

/** The bound translator for the current request. */
export async function getT(): Promise<T> {
  return createT(await getUiLocale());
}

/**
 * The locale for the surfaces that come BEFORE the dashboard — the auth form
 * and every onboarding step. Cookie → English, and deliberately NOT the active
 * site's language.
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
 *
 * A first-time visitor has no cookie and no site, and reads English. That is
 * the intended default, not a gap — see the module comment.
 */
export const getPublicUiLocale = cache(async (): Promise<UiLocale> => {
  // The last language actually chosen — written by the landing's switcher and
  // by the settings API whenever a site's language is saved, so a returning
  // owner keeps the language they picked even while adding a site that
  // publishes in another one.
  return (await chosenLocale()) ?? 'en';
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
