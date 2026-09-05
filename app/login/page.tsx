import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import { LocaleProvider } from '@/components/LocaleProvider';
import { getPublicUiLocale } from '@/lib/i18n/server';

// Dynamic because the locale is resolved from the request (cookie, then
// Accept-Language) — a cached copy would serve one visitor's language to the
// next. AuthForm itself is still the client component; this page only picks
// the language and hands it down.
export const dynamic = 'force-dynamic';

export default async function Page() {
  return (
    <LocaleProvider locale={await getPublicUiLocale()}>
      <Suspense>
        <AuthForm />
      </Suspense>
    </LocaleProvider>
  );
}
