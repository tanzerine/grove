/**
 * Accept-Language parsing, with NO imports.
 *
 * That constraint is the whole point of the file. This runs in middleware (the
 * edge runtime), which bundles everything it can reach — and the obvious home
 * for it, `lib/i18n/server.ts`, pulls in `next/headers`, the Supabase client
 * and the active-domain lookup, none of which belong there. Reaching into
 * `lib/i18n/index.ts` is no better: it imports all four catalogues, so a header
 * parser would drag ~1,100 lines of Korean strings into every request the
 * matcher touches, blog hosts included.
 *
 * So the supported list arrives as an argument rather than being imported.
 * `lib/i18n/server.ts` re-exports a version bound to the product's four codes.
 */

/**
 * The cookie holding the language the owner last CHOSE — written by the
 * landing's switcher and by the Brand voice settings API, read by
 * `getUiLocale`, `getPublicUiLocale` and `landingRedirect`.
 *
 * It lives here rather than next to the catalogues for the same
 * no-dependencies reason: middleware needs the name to decide whether a
 * visitor has already stated a preference, and one definition is what stops
 * the reader and the writer from drifting apart. `lib/i18n` re-exports it.
 */
export const UI_LANG_COOKIE = 'gv_lang';

/**
 * The first language in an `Accept-Language` header that appears in
 * `supported`, honouring q-weights. Returns null when nothing matches, so the
 * caller decides the default rather than having 'en' baked in here.
 */
export function pickAcceptLanguage(
  header: string | null | undefined,
  supported: readonly string[],
): string | null {
  if (!header) return null;
  const ranked = header.split(',')
    .map((chunk) => {
      const [tag, ...params] = chunk.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .filter((p) => p.tag)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    // 'ko-KR' and 'ko' both mean Korean here — grove has no regional variants.
    const base = tag.split('-')[0];
    if (supported.includes(base)) return base;
  }
  return null;
}
