'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useChrome } from './chrome-context';

const ACCENT = '#63c281';

/**
 * The top-right avatar in every page header → the personal account menu:
 * billing, admin (owner only), jump to the live site / Grove home, and log out.
 * Reads account context (email, admin, active hostname) from ChromeProvider.
 */
export default function AccountAvatarMenu() {
  const { email, isAdmin, activeHostname } = useChrome();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function logout() {
    setBusy(true);
    try { await supabaseBrowser().auth.signOut(); } catch { /* clear locally regardless */ }
    window.location.href = '/';
  }

  const initials = (email?.split('@')[0]?.slice(0, 2) ?? 'G').toUpperCase();
  const site = activeHostname ? `https://${activeHostname.replace(/^https?:\/\//, '')}` : null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Account"
        style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(99,194,129,0.3), rgba(99,194,129,0.1))', border: '1px solid rgba(99,194,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: ACCENT, cursor: 'pointer' }}>
        {initials}
      </button>

      {open && (
        <div role="menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 220,
          background: '#15181a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 6, zIndex: 70,
        }}>
          {email && (
            <div style={{ padding: '8px 10px 6px' }}>
              <div style={{ fontSize: 11, color: '#565a53', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Signed in</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#eef1ea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
            </div>
          )}
          <Divider />
          <Item href="/dashboard/billing" onClick={() => setOpen(false)}>Billing &amp; plan</Item>
          {isAdmin && <Item href="/dashboard/admin" onClick={() => setOpen(false)}>Admin overview</Item>}
          {site && <Item href={site} external>Visit your site ↗</Item>}
          <Item href="/" external>Grove home page ↗</Item>
          <Divider />
          <button role="menuitem" onClick={logout} disabled={busy}
            style={{ ...itemStyle, color: '#ff9b9b', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}

const itemStyle: React.CSSProperties = { display: 'block', padding: '9px 10px', borderRadius: 8, fontSize: 13, color: '#cdd2c9', textDecoration: 'none' };

function Item({ href, children, external, onClick }: { href: string; children: React.ReactNode; external?: boolean; onClick?: () => void }) {
  if (external) return <a className="gv-nav" href={href} target="_blank" rel="noopener noreferrer" style={itemStyle}>{children}</a>;
  return <Link className="gv-nav" href={href} onClick={onClick} style={itemStyle}>{children}</Link>;
}

function Divider() {
  return <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />;
}
