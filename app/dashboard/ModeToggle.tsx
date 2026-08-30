'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from './i18n';
import type { T } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

// What a given publish bar means, in plain language.
function floorHint(v: number, t: T): string {
  if (v <= 20) return t('Publishes almost everything — only broken drafts are held');
  if (v <= 45) return t('Skips weak drafts; publishes the rest (recommended)');
  if (v <= 70) return t('Only solid drafts auto-publish — more go to review');
  return t('Only excellent drafts auto-publish — most go to review');
}

export default function ModeToggle({
  domainId, autoPublish, postsPerWeek, autoPublishFloor = 45, maxPostsPerWeek = null,
}: {
  domainId: string;
  autoPublish: boolean;
  postsPerWeek: number;
  autoPublishFloor?: number;
  /** Plan ceiling on cadence; null when the account isn't quota-enforced. */
  maxPostsPerWeek?: number | null;
}) {
  const t = useT();
  const r = useRouter();
  const [auto, setAuto] = useState(autoPublish);
  const [freq, setFreq] = useState(postsPerWeek);
  const [floor, setFloor] = useState(autoPublishFloor);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function save(patch: { auto_publish?: boolean; posts_per_week?: number; auto_publish_floor?: number }) {
    setSaving(true); setBlocked(null);
    const res = await fetch('/api/domains/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain_id: domainId, ...patch }),
    });
    setSaving(false);
    if (!res.ok) {
      // Roll the optimistic toggle back to what the server still believes —
      // otherwise the control claims autopilot is on while drafts keep going
      // to review, and the owner waits for posts that will never publish.
      if (patch.auto_publish !== undefined) setAuto(!patch.auto_publish);
      const j = await res.json().catch(() => ({} as { message?: string }));
      setBlocked(j.message ?? "Couldn't save that — try again.");
      return;
    }
    r.refresh();
  }

  const modeHint = auto ? t('Posts publish automatically on schedule') : t('Posts go to the review queue for approval');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '11px 16px', background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 12, margin: '14px 0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>{t('Publishing')}</span>
        <div style={{ display: 'inline-flex', padding: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, gap: 2 }}>
          {(['Manual', 'Auto'] as const).map((label) => {
            const active = label === 'Auto' ? auto : !auto;
            return (
              <button key={label} disabled={saving}
                onClick={() => { const next = label === t('Auto'); setAuto(next); save({ auto_publish: next }); }}
                style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '5px 15px', borderRadius: 999, transition: '.2s', background: active ? ACCENT : 'transparent', color: active ? 'var(--gv-on-accent)' : 'var(--gv-dim)' }}>
                {t(label)}
              </button>
            );
          })}
        </div>
        <span style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>{t('Cadence')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {[1, 2, 3, 5, 7].map((n) => {
            const active = freq === n;
            // Above the plan's ceiling the server would refuse the write, so
            // show it as unavailable rather than letting them pick and fail.
            const overPlan = maxPostsPerWeek !== null && n > maxPostsPerWeek;
            return (
              <button key={n} disabled={saving || overPlan}
                title={overPlan ? `Your plan allows up to ${maxPostsPerWeek} a week — upgrade to publish more often.` : undefined}
                onClick={() => { setFreq(n); save({ posts_per_week: n }); }}
                style={{ width: 28, height: 28, borderRadius: 8, border: `1px solid ${active ? ACCENT : 'rgba(255,255,255,0.1)'}`, background: active ? ACCENT : 'transparent', color: active ? 'var(--gv-on-accent)' : 'var(--gv-soft)', fontSize: 12, fontWeight: 700, cursor: overPlan ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: overPlan ? 0.35 : 1 }}>
                {n}
              </button>
            );
          })}
          <span style={{ fontSize: 12, color: 'var(--gv-faint)', marginLeft: 2 }}>/ week</span>
          {maxPostsPerWeek !== null && (
            <span style={{ fontSize: 11.5, color: 'var(--gv-fainter)', marginLeft: 4 }}>
              (max {maxPostsPerWeek} on your plan)
            </span>
          )}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', textAlign: 'right', maxWidth: 240 }}>{modeHint}</span>
      </div>

      {/* Why the server refused — most often "no finished draft yet", which is
          the one thing standing between a new account and unreviewed AI content
          on their own domain. Worth a full sentence rather than a toast. */}
      {blocked && (
        <div role="status" style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--gv-soft)', background: 'rgba(224,200,120,0.10)', border: '1px solid rgba(224,200,120,0.30)', borderRadius: 10, padding: '9px 12px' }}>
          {blocked}
        </div>
      )}

      {/* Publish bar — only meaningful on autopilot. Below it: manual review. */}
      {auto && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>{t('Publish bar')}</span>
          <input
            type="range" min={0} max={100} step={5} value={floor} disabled={saving}
            onChange={(e) => setFloor(Number(e.target.value))}
            onPointerUp={() => save({ auto_publish_floor: floor })}
            onKeyUp={() => save({ auto_publish_floor: floor })}
            aria-label={t(t('Minimum quality score to auto-publish'))}
            style={{ flex: '1 1 200px', maxWidth: 320, accentColor: 'var(--gv-accent)', cursor: 'pointer' }}
          />
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3, fontVariantNumeric: 'tabular-nums', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '3px 9px' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: ACCENT_INK }}>{floor}</span>
            <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gv-fainter)' }}>min score</span>
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', textAlign: 'right', maxWidth: 300 }}>
            {floorHint(floor, t)}. {t('Fatal issues (bad facts, thin or broken content) always go to review.')}
          </span>
        </div>
      )}
    </div>
  );
}
