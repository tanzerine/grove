'use client';
/** "Show/hide what grove read" toggle for the GitHub source card — local UI
 *  state only; the actual doc list is precomputed server-side and passed as
 *  children. */
import { useState } from 'react';

export default function RepoDocsToggle({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="gv-toggle"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 10 }}>
        <span>{open ? 'Hide what grove read' : `Show what grove read (${count} item${count === 1 ? '' : 's'})`}</span>
        <span style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .18s' }}>⌄</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, padding: '12px 13px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 14 }}>
          {children}
        </div>
      )}
    </div>
  );
}
