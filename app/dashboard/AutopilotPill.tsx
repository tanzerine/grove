'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCENT = 'var(--gv-accent)';

export default function AutopilotPill({ domainId, autoPublish }: { domainId?: string; autoPublish: boolean }) {
  const r = useRouter();
  const [on, setOn] = useState(autoPublish);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    if (!domainId || saving) return;
    const next = !on;
    setOn(next); setSaving(true);
    await fetch('/api/domains/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, auto_publish: next }),
    });
    setSaving(false); r.refresh();
  }

  return (
    <button onClick={toggle} disabled={!domainId} className="gv-btn"
      style={{ display: 'flex', alignItems: 'center', gap: 9, border: `1px solid ${on ? 'rgba(99,194,129,0.3)' : 'rgba(255,255,255,0.1)'}`, background: on ? 'rgba(99,194,129,0.1)' : 'rgba(255,255,255,0.03)', color: on ? ACCENT : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 999, cursor: 'pointer' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? ACCENT : 'var(--gv-faint)', animation: on ? 'gvPulse 2.4s ease-in-out infinite' : 'none' }} />
      {on ? 'Autopilot on' : 'Autopilot off'}
    </button>
  );
}
