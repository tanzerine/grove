'use client';
import { useEffect, useState } from 'react';
import Icon from '../../gv-icons';
import { useT } from '../../i18n';

const ACCENT = 'var(--gv-accent)';

/** Collapsible left drawer holding the manager score, readiness, AEO/SERP
 *  checks and the pipeline log — the "how this was made" detail that used
 *  to live on the standalone Reviews page. Closed by default; the toggle
 *  surfaces a dot when something in here needs a look. */
export default function ProcessDrawer({ unusual, children }: { unusual?: boolean; children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="gv-ghost"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)',
          color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
          padding: '7px 13px', borderRadius: 9, cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name="gauge" size={15} /></span>
        How this was made
        {unusual && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gv-amber)', flexShrink: 0 }} />}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 44, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
        />
      )}

      <aside
        className="gv-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: 0, left: 0, height: '100%', width: 'min(420px, 92vw)',
          background: 'var(--gv-side)', borderRight: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.5)', zIndex: 45, overflowY: 'auto',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform .28s cubic-bezier(.2,.8,.2,1)',
          padding: '24px 22px 40px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--gv-ink)' }}>{t('How this was made')}</div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginTop: 3 }}>Manager score, readiness &amp; the pipeline log</div>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label={t('Close')}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)', color: 'var(--gv-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </aside>
    </>
  );
}
