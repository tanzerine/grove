'use client';

/**
 * `useT()` — the client half of the UI language.
 *
 * The locale is resolved once, on the server, and rides the existing Chrome
 * context down to every client component. No second provider, no fetch, and
 * no flash of English before a client-side lookup resolves.
 */
import { useMemo } from 'react';
import { useChrome } from './chrome-context';
import { createT, intlLocale, type T } from '@/lib/i18n';

export function useT(): T {
  const { locale } = useChrome();
  return useMemo(() => createT(locale), [locale]);
}

/** Date/number formatting locale for the current user ('ko' → 'ko-KR'). */
export function useIntlLocale(): string {
  const { locale } = useChrome();
  return intlLocale(locale);
}
