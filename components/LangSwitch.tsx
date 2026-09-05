'use client';

/**
 * The landing's language switcher.
 *
 * Two things have to happen on a click, and only one of them is navigation:
 * the visitor goes to the other landing URL, AND `gv_lang` is written so the
 * choice sticks. That cookie is the same one Brand voice writes and the same
 * one `getPublicUiLocale` reads, so picking Korean here also means a Korean
 * sign-up and a Korean onboarding — and it is what stops `landingRedirect`
 * from second-guessing someone who has told us what they want.
 *
 * A plain <a> cannot set a cookie, which is the only reason this is a client
 * component rather than two links.
 */
import { UI_LANG_COOKIE, type UiLocale } from '@/lib/i18n';
import { LANDING_LOCALES } from '@/lib/landing-locale';

/** A year: long enough to be a preference, short enough to lapse eventually. */
const MAX_AGE = 60 * 60 * 24 * 365;

export default function LangSwitch({ current }: { current: UiLocale }) {
  function choose(locale: UiLocale, path: string) {
    try {
      document.cookie = `${UI_LANG_COOKIE}=${locale}; path=/; max-age=${MAX_AGE}; samesite=lax`;
    } catch {
      // Cookies blocked. The navigation below still works; the choice just
      // won't be remembered, which is better than not navigating at all.
    }
    // A full load rather than a client push: every server component re-reads
    // the cookie, so the whole funnel switches with the page.
    window.location.assign(path);
  }

  return (
    <div className="gv-langsw" role="group" aria-label="Language">
      {LANDING_LOCALES.map(({ locale, path, nativeName }) => {
        const on = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-current={on ? 'true' : undefined}
            className={on ? 'gv-langsw-btn on' : 'gv-langsw-btn'}
            onClick={() => { if (!on) choose(locale, path); }}
          >
            {nativeName}
          </button>
        );
      })}
    </div>
  );
}
