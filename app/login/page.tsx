'use client';
export const dynamic = 'force-dynamic';
import { Suspense } from 'react';
import AuthForm from '@/components/AuthForm';

export default function Page() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  );
}
