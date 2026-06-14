import { redirect } from 'next/navigation';
import Landing from '@/components/Landing';
import { supabaseServer } from '@/lib/supabase/server';

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  if (sp.code) redirect(`/auth/callback?code=${sp.code}`);

  // Reflect auth state in the nav so a logged-in visitor doesn't see the
  // signed-out CTA and assume they've been logged out. Middleware keeps the
  // session cookie fresh, so this read is display-only.
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();

  return <Landing loggedIn={!!user} />;
}
