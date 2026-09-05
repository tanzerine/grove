'use client';

/**
 * `useT()` for the surfaces OUTSIDE the dashboard — the auth form and every
 * onboarding step.
 *
 * The dashboard's `useT` (app/dashboard/i18n.tsx) reads the locale off the
 * Chrome context, which carries the whole signed-in shell: plan, entitlement,
 * the site list, the activity feed. None of that exists yet on a sign-up
 * screen, and none of it should have to be assembled just to translate a
 * button. So these surfaces get their own provider holding one field.
 *
 * The locale is still resolved ONCE on the server (`getPublicUiLocale`) and
 * handed down. That is the whole point of a provider rather than a client-side
 * `navigator.language` read: no fetch, no effect, and no flash of English
 * before the right language arrives.
 */
import { createContext, useContext, useMemo, Fragment } from 'react';
import { createT, intlLocale, type T, type UiLocale } from '@/lib/i18n';
import { normalizeLang } from '@/lib/language';

const Ctx = createContext<UiLocale>('en');

export function LocaleProvider({ locale, children }: { locale: UiLocale; children: React.ReactNode }) {
  return <Ctx.Provider value={normalizeLang(locale)}>{children}</Ctx.Provider>;
}

/** The current locale. Defaults to English if a component renders outside the
 *  provider, so a stray render is English rather than a crash. */
export function useLocale(): UiLocale {
  return useContext(Ctx);
}

/** The bound translator. Same call shape as the dashboard's `useT`. */
export function useT(): T {
  const locale = useLocale();
  return useMemo(() => createT(locale), [locale]);
}

/** Date/number formatting locale ('ko' → 'ko-KR'). */
export function useIntlLocale(): string {
  return intlLocale(useLocale());
}

/**
 * Render a translated sentence in which one or more `{placeholders}` are
 * MARKUP rather than text — a monospaced hostname inside a headline, a link
 * inside a paragraph.
 *
 * The alternative is splitting the sentence at the markup and translating the
 * halves — a t() call for "Verify ownership of", then a styled span holding
 * the hostname — which type-checks, passes both i18n guards, and produces
 * broken Korean, because Korean puts the object first and the verb last.
 * CLAUDE.md records the same lesson from the strategy hero. So the sentence
 * stays whole, keeps its placeholder, and the translation is free to move it:
 *
 *   'Verify ownership of {host}'  →  '{host} 소유권 확인'
 *
 * A placeholder with no slot renders literally, which is visible in review
 * rather than silently dropping the customer's own hostname.
 */
export function tNodes(text: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return (
    <>
      {text.split(/(\{\w+\})/g).map((part, i) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        const slot = name === undefined ? undefined : slots[name];
        return <Fragment key={i}>{slot === undefined ? part : slot}</Fragment>;
      })}
    </>
  );
}
