'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, ...patch }),
    });
    setSaving(false);
    r.refresh();
  }

  async function toggleMode() {
    const next = !auto;
    setAuto(next);
    await save({ auto_publish: next });
  }

  async function changeFreq(v: number) {
    setFreq(v);
    await save({ posts_per_week: v });
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 20,
      padding: '14px 18px', background: 'var(--paper)',
      border: '1px solid var(--line)', borderRadius: 12,
      marginBottom: 20, flexWrap: 'wrap',
    }}>
      {/* Auto / Manual pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--clay)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</span>
        <button
          onClick={toggleMode}
          disabled={saving}
          style={{
            display: 'flex', alignItems: 'center', gap: 0,
            background: 'var(--line)', borderRadius: 100, border: 'none',
            padding: 3, cursor: 'pointer', transition: 'opacity .15s',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {['Manual', 'Auto'].map((label) => {
            const active = label === 'Auto' ? auto : !auto;
            return (
              <span key={label} style={{
                padding: '5px 14px', borderRadius: 100, fontSize: 12, fontWeight: 600,
                background: active ? (label === 'Auto' ? 'var(--moss)' : 'white') : 'transparent',
                color: active ? (label === 'Auto' ? 'white' : 'var(--ink)') : 'var(--clay)',
                transition: 'all .15s',
              }}>
                {label}
              </span>
            );
          })}
        </button>
        <span style={{ fontSize: 12, color: 'var(--clay)' }}>
          {auto ? 'Posts publish automatically on schedule' : 'Posts go to review queue for approval'}
        </span>
      </div>

      {/* Frequency (only meaningful in auto) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <span style={{ fontSize: 12, color: 'var(--clay)' }}>Posts per week</span>
        {[1, 2, 3, 5, 7].map((n) => (
          <button
            key={n}
            onClick={() => changeFreq(n)}
            disabled={saving}
            style={{
              width: 32, height: 32, borderRadius: 8, border: '1px solid',
              borderColor: freq === n ? 'var(--moss)' : 'var(--line)',
              background: freq === n ? 'var(--moss)' : 'white',
              color: freq === n ? 'white' : 'var(--ink)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
