import React from 'react';
import Icon from './gv-icons';

const ACCENT = '#63c281';

/** The bell + avatar cluster on the right of every page's sticky topbar. */
export function HeaderRight({ initials = 'MR', before }: { initials?: string; before?: React.ReactNode }) {
  return (
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
      {before}
      {before ? <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.08)' }} /> : null}
      <button className="gv-ghost" style={{ position: 'relative', width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', color: '#9aa096', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="bell" />
        <span style={{ position: 'absolute', top: 9, right: 9, width: 6, height: 6, borderRadius: '50%', background: ACCENT }} />
      </button>
      <span style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(99,194,129,0.3), rgba(99,194,129,0.1))', border: '1px solid rgba(99,194,129,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, color: ACCENT }}>{initials}</span>
    </div>
  );
}

/** A standard card surface used across pages. */
export function card(extra: React.CSSProperties = {}): React.CSSProperties {
  return { background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, ...extra };
}
