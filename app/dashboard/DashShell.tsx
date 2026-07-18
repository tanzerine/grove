'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import SideNav from './SideNav';
import SiteSwitcher from './SiteSwitcher';
import AssistantPanel from './AssistantPanel';
import { ChromeProvider, type Chrome } from './chrome-context';

const ACCENT = 'var(--gv-accent)';

export default function DashShell({
  chrome,
  badges,
  children,
}: {
  chrome: Chrome;
  badges?: Record<string, number>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <ChromeProvider value={chrome}>
      <div className={`gv-app ${open ? 'nav-open' : ''}`}>
        {/* mobile top chrome */}
        <div className="gv-mtop">
          <button type="button" className="gv-burger" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span /><span /><span />
          </button>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em', color: 'var(--gv-ink)' }}>
            <span style={{ width: 17, height: 17, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, var(--mint), var(--gv-accent))', boxShadow: '0 0 12px rgba(99,194,129,0.7)' }} />
            grove
          </Link>
        </div>
        <div className="gv-scrim" onClick={() => setOpen(false)} aria-hidden />

        {/* sidebar */}
        <aside className="gv-side gv-scroll">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '22px 22px 18px' }}>
            <span style={{ width: 17, height: 17, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, var(--mint), var(--gv-accent))', boxShadow: '0 0 12px rgba(99,194,129,0.7)' }} />
            <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.02em' }}>grove</span>
            <Link href="/dashboard/billing" title="Manage billing" style={{ marginLeft: 'auto', fontSize: 9.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, border: '1px solid rgba(99,194,129,0.3)', borderRadius: 6, padding: '3px 7px' }}>{chrome.plan}</Link>
          </div>

          <SideNav badges={badges} isAdmin={chrome.isAdmin} />

          <SiteSwitcher domains={chrome.domains} activeId={chrome.activeId} />
        </aside>

        {/* main scroll region — owns the ambient glow; each page renders its own header + body */}
        <main className="gv-main gv-scroll">
          <div className="gv-glow"><div className="b1" /><div className="b2" /><div className="b3" /></div>
          {children}
        </main>

        {/* agent chat — right sidebar */}
        <AssistantPanel />
      </div>
    </ChromeProvider>
  );
}
