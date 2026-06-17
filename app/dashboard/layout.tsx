import GroveMark from '@/components/GroveMark';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import DashShell from './DashShell';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: domains } = await sb.from('domains').select('id,hostname,verified_at').order('created_at');
  const verified = domains?.find((d) => d.verified_at);
  if (!verified && (domains?.length ?? 0) === 0) redirect('/onboarding/domain');

  return (
    <>
      <GroveMark />
      <DashShell verified={verified ? { hostname: verified.hostname } : null}>
        {children}
      </DashShell>
    </>
  );
}
