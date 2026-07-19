import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';
import StructuredData from '@/components/StructuredData';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/' },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  if (sp.code) redirect(`/auth/callback?code=${sp.code}`);

  // Reflect auth state in the nav so a logged-in visitor doesn't see the
  // signed-out CTA and assume they've been logged out. Middleware keeps the
  // session cookie fresh, so this read is display-only.
  //
  // Fail-safe: this is the public marketing page, so a missing env var or an
  // unreachable/paused auth backend must NOT 500 it. Treat any failure as
  // signed-out and still render the landing. (Same defense as middleware, #71.)
  let loggedIn = false;
  try {
    const sb = await supabaseServer();
    const { data: { user } } = await sb.auth.getUser();
    loggedIn = !!user;
  } catch {
    // backend down or misconfigured — render the signed-out landing
  }

  return (
    <>
      {/* Preload so GT Walsheim (the hero/heading font) is ready before first
          paint — pairs with font-display:block in Landing.tsx to avoid any
          visible fallback-font flash. */}
      <link rel="preload" href="/fonts/GTWalsheim-Medium.otf" as="font" type="font/otf" crossOrigin="anonymous" />
      <StructuredData />
      <Landing loggedIn={loggedIn} />
    </>
  );
}
