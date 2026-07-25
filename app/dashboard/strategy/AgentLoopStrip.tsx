'use client';
/**
 * "The loop" — the four-stage architecture (Strategy → Generation → Manager →
 * Analytics) as a clickable pill strip (Grove Strategy .dc comp). Purely a
 * local-state explainer: clicking a pill swaps the detail line on the right
 * to that stage's real, precomputed status — nothing here fetches or mutates.
 */
import { useState } from 'react';
import Icon from '../gv-icons';

const ACCENT_INK = 'var(--gv-accent-ink)';

type Step = { label: string; icon: string; detail: string };

export default function AgentLoopStrip({ steps }: { steps: Step[] }) {
  const [sel, setSel] = useState(0);
  const cur = steps[sel] ?? steps[0];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '12px 18px', background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 13, marginBottom: 18 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginRight: 8 }}>The loop</span>
      {steps.map((s, i) => {
        const active = i === sel;
        return (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button onClick={() => setSel(i)} className="gv-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 13px', borderRadius: 999, border: `1px solid ${active ? 'rgba(162,255,1,0.4)' : 'rgba(255,255,255,0.1)'}`, background: active ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.03)', color: active ? 'var(--gv-ink)' : 'var(--gv-dim)', cursor: 'pointer', fontFamily: 'inherit' }}>
              <span style={{ display: 'flex' }}><Icon name={s.icon} size={14} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</span>
              {i === 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT_INK, animation: 'gvPulse 2.4s ease-in-out infinite' }} />}
            </button>
            {i < steps.length - 1 && <span style={{ color: '#4a4d44', padding: '0 3px', display: 'flex' }}><Icon name="arrow" size={14} /></span>}
          </span>
        );
      })}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--gv-faint)', textAlign: 'right' }}>{cur.detail}</span>
    </div>
  );
}
