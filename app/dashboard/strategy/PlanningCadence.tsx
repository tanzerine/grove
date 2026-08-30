'use client';
/**
 * "Planning cadence" — Monthly / Weekly / Daily views of the same plan, at
 * different resolutions (Grove Strategy .dc comp). Each view's items are
 * precomputed server-side from real goals/plan/horizon data; this just
 * switches which precomputed list is shown.
 */
import { useState } from 'react';
import Icon from '../gv-icons';
import { useT } from '../i18n';

const ACCENT_INK = 'var(--gv-accent-ink)';

export type CadenceItem = { label: string; meta: string; state: 'done' | 'progress' | 'queued' };
export type CadenceView = {
  key: 'monthly' | 'weekly' | 'daily';
  label: string;
  period: string;
  /** The horizon headline for this window — what we're heading toward. */
  detail?: string;
  items: CadenceItem[];
};

function Dot({ state }: { state: CadenceItem['state'] }) {
  const done = state === 'done', prog = state === 'progress';
  return (
    <span style={{
      width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: done ? 'rgba(162,255,1,0.14)' : prog ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${done ? 'rgba(162,255,1,0.4)' : prog ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)'}`,
      color: done ? ACCENT_INK : 'var(--gv-dim)',
    }}>
      {done ? <Icon name="check" size={10} /> : null}
    </span>
  );
}

export default function PlanningCadence({ views }: { views: CadenceView[] }) {
  const t = useT();
  const [sel, setSel] = useState<CadenceView['key']>('weekly');
  const cur = views.find((v) => v.key === sel) ?? views[0];

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 24px 22px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t('Planning cadence')}</span>
        <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>how the agent breaks the plan down</span>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', padding: 4, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, gap: 3 }}>
          {views.map((v) => {
            const active = v.key === sel;
            return (
              <button key={v.key} onClick={() => setSel(v.key)}
                style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 15px', borderRadius: 999, transition: '.2s', background: active ? '#f5f6f2' : 'transparent', color: active ? '#12160a' : 'var(--gv-dim)' }}>
                {v.label}
              </button>
            );
          })}
        </div>
      </div>
      {cur.detail && (
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.45, marginBottom: 5 }}>{cur.detail}</div>
      )}
      <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 12 }}>{cur.period}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {cur.items.length === 0 && <p style={{ color: 'var(--gv-faint)', fontSize: 13, margin: '6px 0' }}>{t('Nothing scheduled in this window.')}</p>}
        {cur.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Dot state={it.state} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: it.state === 'done' ? 'var(--gv-faint)' : '#e4e6df' }}>{it.label}</span>
            <span style={{ fontSize: 11.5, color: 'var(--gv-faint)', whiteSpace: 'nowrap' }}>{it.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
