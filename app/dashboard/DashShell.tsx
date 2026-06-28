'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import SideNav from './SideNav';
import AccountMenu from './AccountMenu';

const ACCENT = '#63c281';

export default function DashShell({
  verified,
  account,
  badges,
  plan = 'Free',
  isAdmin = false,
  children,
}: {
  verified?: { hostname: string } | null;
  account?: { name: string; sub: string } | null;
  badges?: Record<string, number>;
  plan?: string;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  const acctName = account?.name ?? verified?.hostname ?? 'grove.ai';
  const acctSub = account?.sub ?? (verified ? 'verified · autopilot on' : 'setup in progress');

  return (
    <div className={`gv-app ${open ? 'nav-open' : ''}`}>
      {/* mobile top chrome */}
      <div className="gv-mtop">
        <button type="button" className="gv-burger" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span /><span /><span />
        </button>
        <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: '#eef1ea' }}>
          <span style={{ width: 17, height: 17, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #9ff0bb, #63c281)', boxShadow: '0 0 12px rgba(99,194,129,0.7)' }} />
          grove
        </Link>
      </div>
      <div className="gv-scrim" onClick={() => setOpen(false)} aria-hidden />

      {/* sidebar */}
      <aside className="gv-side gv-scroll">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '22px 22px 18px' }}>
          <span style={{ width: 17, height: 17, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #9ff0bb, #63c281)', boxShadow: '0 0 12px rgba(99,194,129,0.7)' }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>grove</span>
          <Link href="/dashboard/billing" title="Manage billing" style={{ marginLeft: 'auto', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, border: '1px solid rgba(99,194,129,0.3)', borderRadius: 6, padding: '3px 7px' }}>{plan}</Link>
        </div>

        <SideNav badges={badges} isAdmin={isAdmin} />

        <AccountMenu name={acctName} sub={acctSub} hostname={verified?.hostname ?? null} isAdmin={isAdmin} />
      </aside>

      {/* main scroll region — owns the ambient glow; each page renders its own header + body */}
      <main className="gv-main gv-scroll">
        <div className="gv-glow"><div className="b1" /><div className="b2" /><div className="b3" /></div>
        {children}
      </main>
    </div>
  );
}
