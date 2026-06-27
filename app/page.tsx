import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';
import { supabaseServer } from '@/lib/supabase/server';

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

  return <Landing loggedIn={loggedIn} />;
}
