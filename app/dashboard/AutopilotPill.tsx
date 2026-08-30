'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export default function AutopilotPill({ domainId, autoPublish }: { domainId?: string; autoPublish: boolean }) {
  const t = useT();
  const r = useRouter();
  const [on, setOn] = useState(autoPublish);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function toggle() {
    if (!domainId || saving) return;
    const next = !on;
    setOn(next); setSaving(true); setBlocked(null);
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, auto_publish: next }),
    });
    setSaving(false);
    if (!res.ok) {
      // The optimistic flip has to come back: the server refused (no finished
      // draft yet), and a pill reading "Autopilot on" over a domain that is
      // still in review mode is the same class of lie as a green failed post.
      setOn(!next);
      const j = await res.json().catch(() => ({} as { message?: string }));
      setBlocked(j.message ?? "Couldn't change autopilot — try again.");
      return;
    }
    r.refresh();
  }

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={toggle} disabled={!domainId} className="gv-btn"
        style={{ display: 'flex', alignItems: 'center', gap: 9, border: `1px solid ${on ? 'rgba(162,255,1,0.3)' : 'rgba(255,255,255,0.1)'}`, background: on ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.03)', color: on ? ACCENT_INK : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 999, cursor: 'pointer' }}>
        {/* ACCENT_INK, not ACCENT — solid lime on the pill's own pale-lime wash
            measures ~1.1:1, the dot all but vanishes into its own background. */}
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? ACCENT_INK : 'var(--gv-faint)', animation: on ? 'gvPulse 2.4s ease-in-out infinite' : 'none' }} />
        {on ? t('Autopilot on') : t('Autopilot off')}
      </button>
      {blocked && (
        <div role="status" onClick={() => setBlocked(null)}
          style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 40, width: 280, padding: '10px 12px', background: 'var(--gv-card)', border: '1px solid rgba(224,200,120,0.35)', borderRadius: 10, fontSize: 12.5, lineHeight: 1.45, color: 'var(--gv-soft)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', cursor: 'pointer' }}>
          {blocked}
        </div>
      )}
    </div>
  );
}
