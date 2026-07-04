'use client';
import { useState } from 'react';

const ACCENT = 'var(--gv-accent)';

export type Spoke = { label: string; status: 'published' | 'planned' | 'gap' };
export type Cluster = { hub: string; color: string; spokes: Spoke[] };

const STYLE: Record<Spoke['status'], { fill: string; stroke: string; line: string; dash: string; text: string; tr: boolean }> = {
  published: { fill: ACCENT, stroke: ACCENT, line: 'rgba(99,194,129,0.45)', dash: '0', text: 'var(--gv-soft)', tr: false },
  planned: { fill: 'rgba(127,182,230,0.18)', stroke: 'var(--gv-sky)', line: 'rgba(127,182,230,0.4)', dash: '0', text: 'var(--gv-dim)', tr: false },
  gap: { fill: 'rgba(224,200,120,0.08)', stroke: 'var(--gv-amber)', line: 'rgba(224,200,120,0.4)', dash: '4 4', text: '#9aa79e', tr: true },
};

function ClusterSvg({ hub, spokes }: { hub: string; spokes: Spoke[] }) {
  const W = 540, H = 392, cx = 270, cy = 196, R = 138;
  const n = Math.max(spokes.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: 360, overflow: 'visible' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={R * 0.5} fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={1} />
      {spokes.map((s, i) => {
        const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
        const nx = cx + R * Math.cos(a), ny = cy + R * Math.sin(a);
        const st = STYLE[s.status] || STYLE.planned;
        return <line key={`l${i}`} x1={cx} y1={cy} x2={nx} y2={ny} stroke={st.line} strokeWidth={1.4} strokeDasharray={st.dash} style={st.tr ? { animation: 'gvDash 1.6s linear infinite' } : undefined} />;
      })}
      {/* hub */}
      <circle cx={cx} cy={cy} r={40} fill="rgba(99,194,129,0.08)" stroke="rgba(99,194,129,0.3)" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={34} fill="var(--gv-card)" stroke="rgba(99,194,129,0.5)" strokeWidth={1.5} />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="Plus Jakarta Sans, sans-serif" fill="var(--gv-faint)" letterSpacing="0.08em">HUB</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize={12} fontWeight={700} fontFamily="Plus Jakarta Sans, sans-serif" fill="var(--gv-ink)">{hub}</text>
      {spokes.map((s, i) => {
        const a = -Math.PI / 2 + i * ((2 * Math.PI) / n);
        const nx = cx + R * Math.cos(a), ny = cy + R * Math.sin(a);
        const lx = cx + (R + 16) * Math.cos(a), ly = cy + (R + 16) * Math.sin(a);
        const anchor = Math.cos(a) > 0.2 ? 'start' : Math.cos(a) < -0.2 ? 'end' : 'middle';
        const st = STYLE[s.status] || STYLE.planned;
        return (
          <g key={`n${i}`}>
            <circle className="gv-node" cx={nx} cy={ny} r={8.5} fill={st.fill} stroke={st.stroke} strokeWidth={1.8} strokeDasharray={st.dash} />
            <text x={lx} y={ly + 3.5} textAnchor={anchor} fontSize={11} fontWeight={600} fontFamily="Plus Jakarta Sans, sans-serif" fill={st.text}>{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function StrategyClusterMap({ clusters }: { clusters: Cluster[] }) {
  const [pi, setPi] = useState(0);
  const safe = clusters.length ? clusters : [{ hub: 'Plan', color: ACCENT, spokes: [] as Spoke[] }];
  const idx = pi % safe.length;
  const cur = safe[idx];
  const covered = cur.spokes.filter((s) => s.status === 'published').length;
  const gaps = cur.spokes.filter((s) => s.status === 'gap').length;

  const legend = [
    { label: 'Published', color: ACCENT },
    { label: 'Planned', color: 'var(--gv-sky)' },
    { label: 'Gap', color: 'var(--gv-amber)' },
  ];

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Topical authority map</div>
          <div style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 3 }}>Hub-and-spoke clusters — own a topic, not just a keyword</div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {legend.map((l) => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: 'var(--gv-dim)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color }} />{l.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '18px 0 6px' }}>
        {safe.map((c, i) => {
          const active = i === idx;
          return (
            <button key={i} onClick={() => setPi(i)} className="gv-pill"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, border: `1px solid ${active ? 'rgba(99,194,129,0.28)' : 'rgba(255,255,255,0.08)'}`, background: active ? 'rgba(99,194,129,0.1)' : 'rgba(255,255,255,0.02)', color: active ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color }} />{c.hub}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 6 }}><ClusterSvg hub={cur.hub} spokes={cur.spokes} /></div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--gv-faint)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 6 }}>
        <span><span style={{ color: ACCENT, fontWeight: 600 }}>{covered}</span> of {cur.spokes.length} spokes covered · {gaps} gap{gaps === 1 ? '' : 's'} worth filling</span>
        <button className="gv-btn" style={{ border: '1px solid rgba(99,194,129,0.25)', background: 'rgba(99,194,129,0.08)', color: ACCENT, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 9, cursor: 'pointer' }}>Queue the {gaps} gap{gaps === 1 ? '' : 's'} →</button>
      </div>
    </div>
  );
}
