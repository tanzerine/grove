import Link from 'next/link';
import GroveMark from '@/components/GroveMark';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import SideNav from './SideNav';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  const { data: domains } = await sb.from('domains').select('id,hostname,verified_at').order('created_at');
  const verified = domains?.find((d) => d.verified_at);
  if (!verified && (domains?.length ?? 0) === 0) redirect('/onboarding/domain');

  return (
    <div className="dash" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <GroveMark />
      <aside className="dash-side" style={{ padding: 24, background: 'var(--paper)', borderRight: '1px solid var(--line)' }}>
        <Link href="/" className="sb-brand">
          <span className="mark"><svg viewBox="0 0 32 32"><use href="#grove-mark" /></svg></span>
          grove<span className="dot">.</span>
        </Link>
        <SideNav />
        {verified && (
          <div style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div className="verified-chip"><span className="v">✓</span>{verified.hostname} verified</div>
          </div>
        )}
      </aside>
      <main style={{ padding: '40px 48px', overflow: 'auto' }}>{children}</main>
    </div>
  );
}
