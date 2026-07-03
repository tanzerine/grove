'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCENT = 'var(--gv-accent)';

export default function ModeToggle({
  domainId, autoPublish, postsPerWeek,
}: { domainId: string; autoPublish: boolean; postsPerWeek: number }) {
  const r = useRouter();
  const [auto, setAuto] = useState(autoPublish);
  const [freq, setFreq] = useState(postsPerWeek);
  const [saving, setSaving] = useState(false);

  async function save(patch: { auto_publish?: boolean; posts_per_week?: number }) {
    setSaving(true);
    await fetch('/api/domains/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, ...patch }),
    });
    setSaving(false); r.refresh();
  }

  const modeHint = auto ? 'Posts publish automatically on schedule' : 'Posts go to the review queue for approval';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 16px', background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, margin: '14px 0 4px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>Publishing</span>
      <div style={{ display: 'inline-flex', padding: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, gap: 2 }}>
        {(['Manual', 'Auto'] as const).map((label) => {
          const active = label === 'Auto' ? auto : !auto;
          return (
            <button key={label} disabled={saving}
              onClick={() => { const next = label === 'Auto'; setAuto(next); save({ auto_publish: next }); }}
              style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '5px 15px', borderRadius: 999, transition: '.2s', background: active ? ACCENT : 'transparent', color: active ? 'var(--gv-on-accent)' : 'var(--gv-dim)' }}>
              {label}
            </button>
          );
        })}
      </div>
      <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />
      <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>Cadence</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {[1, 2, 3, 5, 7].map((n) => {
          const active = freq === n;
          return (
            <button key={n} disabled={saving} onClick={() => { setFreq(n); save({ posts_per_week: n }); }}
              style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.1)'}`, background: active ? ACCENT : 'transparent', color: active ? 'var(--gv-on-accent)' : 'var(--gv-soft)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              {n}
            </button>
          );
        })}
        <span style={{ fontSize: 12, color: 'var(--gv-faint)', marginLeft: 2 }}>/ week</span>
      </div>
      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', textAlign: 'right', maxWidth: 240 }}>{modeHint}</span>
    </div>
  );
}
