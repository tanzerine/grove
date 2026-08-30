/**
 * Server-side locale resolution for RSC pages and route handlers.
 *
 * Order, most explicit first:
 *   1. the `gv_lang` cookie — what the switcher just wrote, so a change takes
 *      effect on the next render with no database round trip;
 *   2. the user's saved choice (auth metadata) — follows them to a new device,
 *      where there is no cookie yet;
 *   3. `Accept-Language` — a first-time Korean visitor should not have to find
 *      a menu to read the page they just landed on;
 *   4. English.
 *
 * `cache()` makes the whole thing once per request, so a page that calls
 * `getT()` and a layout that resolves the same locale share one auth lookup.
 */
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { supabaseServer } from '../supabase/server';
import { normalizeLang, LANG_CODES } from '../language';
import { createT, UI_LANG_COOKIE, UI_LANG_METADATA_KEY, type T, type UiLocale } from './index';

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
    if ((LANG_CODES as readonly string[]).includes(base)) return base as UiLocale;
  }
  return null;
}

export const getUiLocale = cache(async (): Promise<UiLocale> => {
  const jar = await cookies();
  const cookieValue = jar.get(UI_LANG_COOKIE)?.value;
  if (cookieValue && (LANG_CODES as readonly string[]).includes(cookieValue)) {
    return cookieValue as UiLocale;
  }

  // Saved preference. Best-effort: an unauthenticated or failing lookup must
  // never take a page down over a label.
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    const saved = (user?.user_metadata as Record<string, unknown> | undefined)?.[UI_LANG_METADATA_KEY];
    if (typeof saved === 'string' && (LANG_CODES as readonly string[]).includes(saved)) {
      return saved as UiLocale;
    }
  } catch { /* fall through to the header */ }

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

/** Resolve without the auth lookup — for contexts that already have the user. */
export function localeFor(user: { user_metadata?: Record<string, unknown> } | null, cookieValue?: string | null): UiLocale {
  if (cookieValue && (LANG_CODES as readonly string[]).includes(cookieValue)) return cookieValue as UiLocale;
  const saved = user?.user_metadata?.[UI_LANG_METADATA_KEY];
  return normalizeLang(typeof saved === 'string' ? saved : undefined);
}
