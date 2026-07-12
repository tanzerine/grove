'use client';
export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';

// Kept as an alias so existing landing/pricing links (?domain=, ?plan=) keep
// working — there is no separate sign-up flow anymore; this renders the one
// unified auth surface, same as /login.
export default function Page() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
