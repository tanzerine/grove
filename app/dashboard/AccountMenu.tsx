'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';

const ACCENT = '#63c281';

/**
 * The sidebar-bottom account button → a popover menu for managing the account:
 * billing, jumping to the live site, back to the Grove home/landing page,
 * admin (owner only), and — the previously-missing — log out.
 */
export default function AccountMenu({
  name,
  sub,
  hostname,
  isAdmin = false,
}: {
  name: string;
  sub: string;
  hostname?: string | null;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    try {
      await supabaseBrowser().auth.signOut();
    } catch { /* clear locally regardless */ }
    // Hard navigation so the server re-reads the (now cleared) session cookie.
    window.location.href = '/';
  }

  const site = hostname ? `https://${hostname.replace(/^https?:\/\//, '')}` : null;

  return (
    <div ref={ref} style={{ position: 'relative', padding: 14, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 'auto' }}>
      {open && (
        <div role="menu" style={{
          position: 'absolute', left: 14, right: 14, bottom: 'calc(100% - 6px)',
          background: '#15181a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 6, zIndex: 60,
        }}>
          <div style={{ padding: '8px 10px 6px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eef1ea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
            <div style={{ fontSize: 11, color: '#6b6f67' }}>{sub}</div>
          </div>
          <Divider />
          <Item href="/dashboard/billing" onClick={() => setOpen(false)}>Billing &amp; plan</Item>
          {isAdmin && <Item href="/dashboard/admin" onClick={() => setOpen(false)}>Admin overview</Item>}
          {site && <Item href={site} external>Visit your site ↗</Item>}
          <Item href="/" external>Grove home page ↗</Item>
          <Divider />
          <button role="menuitem" onClick={logout} disabled={busy} style={{ ...itemStyle, color: '#ff9b9b', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}

      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="gv-ghost"
        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(99,194,129,0.12)', border: '1px solid rgba(99,194,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>g</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#eef1ea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
          <span style={{ display: 'block', fontSize: 11, color: '#6b6f67' }}>{sub}</span>
        </span>
        <span style={{ color: '#6b6f67', fontSize: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>⌄</span>
      </button>
    </div>
  );
}

const itemStyle: React.CSSProperties = {
  display: 'block', padding: '9px 10px', borderRadius: 8, fontSize: 13, color: '#cdd2c9', textDecoration: 'none',
};

function Item({ href, children, external, onClick }: { href: string; children: React.ReactNode; external?: boolean; onClick?: () => void }) {
  const cls = 'gv-nav';
  if (external) {
    return <a className={cls} href={href} target="_blank" rel="noopener noreferrer" style={itemStyle}>{children}</a>;
  }
  return <Link className={cls} href={href} onClick={onClick} style={itemStyle}>{children}</Link>;
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />;
}
