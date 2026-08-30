'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import type { ChromeDomain } from './chrome-context';
import { useT } from './i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

/**
 * Bottom-of-sidebar site switcher (Instagram-style): the same user can connect
 * several websites and switch which one they're managing. Switching sets the
 * active-site cookie via /api/domains/switch, then reloads so every server
 * page re-scopes to the chosen site.
 */
export default function SiteSwitcher({ domains, activeId }: { domains: ChromeDomain[]; activeId: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const active = domains.find((d) => d.id === activeId) ?? domains[0] ?? null;

  async function switchTo(id: string) {
    if (id === activeId) { setOpen(false); return; }
    setSwitching(id);
    const res = await fetch('/api/domains/switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      // Full reload so all server components re-read the new active-site cookie.
      window.location.href = '/dashboard';
    } else {
      setSwitching(null);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', padding: 14, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 'auto' }}>
      {open && (
        <div role="menu" style={{
          position: 'absolute', left: 14, right: 14, bottom: 'calc(100% - 6px)',
          background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
          boxShadow: '0 16px 40px rgba(0,0,0,0.55)', padding: 6, zIndex: 60, maxHeight: 360, overflowY: 'auto',
        }}>
          <div style={{ padding: '6px 10px 8px', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>{t('Your sites')}</div>
          {domains.map((d) => {
            const isActive = d.id === activeId;
            return (
              <button key={d.id} role="menuitem" onClick={() => switchTo(d.id)} disabled={switching !== null}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: isActive ? 'rgba(162,255,1,0.1)' : 'transparent', border: 'none', borderRadius: 9, padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Avatar host={d.hostname} active={isActive} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.hostname}</span>
                  <span style={{ display: 'block', fontSize: 11, color: d.verified_at ? 'var(--gv-faint)' : 'var(--gv-amber)' }}>{d.verified_at ? 'verified' : 'setup in progress'}</span>
                </span>
                {switching === d.id ? <span style={{ fontSize: 11, color: 'var(--gv-dim)' }}>…</span> : isActive ? <span style={{ color: ACCENT_INK, fontSize: 13 }}>✓</span> : null}
              </button>
            );
          })}
          <div style={{ height: 1, background: 'var(--gv-line)', margin: '6px 0' }} />
          <Link href="/onboarding/domain" className="gv-nav" onClick={() => setOpen(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, fontSize: 13, color: ACCENT_INK, textDecoration: 'none' }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, border: '1px dashed rgba(162,255,1,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1 }}>+</span>
            {t('Connect another website')}
          </Link>
        </div>
      )}

      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="gv-ghost"
        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <Avatar host={active?.hostname ?? 'grove'} active />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{active?.hostname ?? t('No site yet')}</span>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--gv-faint)' }}>{domains.length > 1 ? `${domains.length} sites · switch` : 'manage site'}</span>
        </span>
        <span style={{ color: 'var(--gv-faint)', fontSize: 13, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>⌄</span>
      </button>
    </div>
  );
}

function Avatar({ host, active }: { host: string; active?: boolean }) {
  const letter = (host.replace(/^https?:\/\//, '')[0] ?? 'g').toUpperCase();
  return (
    <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: active ? 'rgba(162,255,1,0.14)' : 'rgba(255,255,255,0.05)', border: `1px solid ${active ? 'rgba(162,255,1,0.3)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: active ? ACCENT_INK : 'var(--gv-dim)', fontWeight: 700, fontSize: 13 }}>{letter}</span>
  );
}
