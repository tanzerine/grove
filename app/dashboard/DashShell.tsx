'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import SideNav from './SideNav';

export default function DashShell({
  verified,
  children,
}: {
  verified?: { hostname: string } | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className={`dash dash-shell ${open ? 'nav-open' : ''}`}>
      <div className="dash-topbar">
        <button
          type="button"
          className="dash-burger"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>
        <Link href="/" className="sb-brand">
          <span className="mark"><svg viewBox="0 0 32 32"><use href="#grove-mark" /></svg></span>
          grove<span className="dot">.</span>
        </Link>
      </div>

      <div
        className="dash-scrim"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside className="dash-side">
        <Link href="/" className="sb-brand sb-brand-desktop">
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

      <main className="dash-content">{children}</main>
    </div>
  );
}
