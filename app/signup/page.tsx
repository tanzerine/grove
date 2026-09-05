import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';
import { LocaleProvider } from '@/components/LocaleProvider';
import { getPublicUiLocale } from '@/lib/i18n/server';

// Kept as an alias so existing landing/pricing links (?domain=, ?plan=) keep
// working — there is no separate sign-up flow anymore; this renders the one
// unified auth surface, same as /login.
//
// Dynamic for the same reason /login is: the locale comes off the request.
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
