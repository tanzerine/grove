'use client';
import { useState } from 'react';
import Link from 'next/link';
import Icon from './gv-icons';

// ACCENT is the lime fill/border; ACCENT_INK is the olive to use whenever the
// accent has to read as text (lime is ~1.1:1 on the white canvas).
const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

export type OvRow = {
  id: string;
  icon: string;
  accentIcon: boolean;
  title: string;
  meta: string;
  keyword: string;
  words: string;
  s: 'publishing' | 'review' | 'live' | 'writing' | 'failed';
  schedule: string;
};

const ST: Record<OvRow['s'], { status: string; color: string; bg: string; border: string; dot: string }> = {
  publishing: { status: 'Publishing', color: 'var(--gv-ink)', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.16)', dot: 'var(--gv-ink)' },
  review: { status: 'In review', color: 'var(--gv-soft)', bg: 'rgba(255,255,255,0.09)', border: 'rgba(255,255,255,0.22)', dot: 'var(--gv-soft)' },
  /* Label colours sit on a tinted chip, which shaves ~0.3 off the ratio — hence
     --gv-soft rather than the muted tiers, and --gv-red-text rather than the
     border-weight --gv-red. The dots keep the lighter tones for hierarchy. */
  live: { status: 'Live', color: 'var(--gv-soft)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', dot: 'var(--gv-dim)' },
  writing: { status: 'Drafting', color: 'var(--gv-soft)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.14)', dot: 'var(--gv-faint)' },
  failed: { status: 'Failed', color: 'var(--gv-red-text)', bg: 'rgba(201,79,79,0.08)', border: 'rgba(201,79,79,0.22)', dot: 'var(--gv-red)' },
};

export default function OverviewPipeline({ groups }: { groups: Record<string, OvRow[]> }) {
  const tabDef = [
    { label: 'Recent', count: String(groups['Recent']?.length ?? 0) },
    { label: 'Pipeline', count: String(groups['Pipeline']?.length ?? 0) },
    { label: 'In review', count: String(groups['In review']?.length ?? 0) },
    { label: 'Published', count: String(groups['Published']?.length ?? 0) },
  ];
  // Default to the first tab that actually has posts so the table never opens empty.
  const [tab, setTab] = useState(() => tabDef.find((t) => t.count !== '0')?.label ?? 'Recent');
  const rows = groups[tab] ?? [];
  const cols = '1fr 200px 90px 130px 120px';

  return (
    <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Content pipeline</span>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tabDef.map((t) => {
              const active = tab === t.label;
              return (
                <button key={t.label} onClick={() => setTab(t.label)}
                  style={{ border: `1px solid ${active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.1)'}`, background: active ? 'rgba(255,255,255,0.06)' : 'transparent', color: active ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}>
                  {t.label} <span style={{ opacity: 0.6 }}>{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Link href="/dashboard/pipeline" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textDecoration: 'none' }}>View all →</Link>
      </div>

      <div className="gv-tbl" style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '11px 22px', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span>Post</span><span className="gv-cell-off">Target keyword</span><span className="gv-cell-off">Words</span><span>Status</span><span className="gv-cell-off" style={{ textAlign: 'right' }}>Schedule</span>
      </div>

      {rows.map((r) => {
        const st = ST[r.s];
        return (
          <Link key={r.id} href={`/dashboard/posts/${r.id}`} className="gv-row gv-tbl"
            style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, alignItems: 'center', padding: '15px 22px', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background .15s', cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 18 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: r.accentIcon ? 'rgba(162,255,1,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${r.accentIcon ? 'rgba(162,255,1,0.4)' : 'rgba(255,255,255,0.12)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: r.accentIcon ? ACCENT_INK : 'var(--gv-dim)', flexShrink: 0 }}>
                <Icon name={r.icon} size={15} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--gv-faint)' }}>{r.meta}</span>
              </span>
            </div>
            <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>{r.keyword}</span>
            <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-soft)' }}>{r.words}</span>
            <span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: st.color, background: st.bg, border: `1px solid ${st.border}`, padding: '4px 10px', borderRadius: 999 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />{st.status}
              </span>
            </span>
            <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textAlign: 'right' }}>{r.schedule}</span>
          </Link>
        );
      })}
      {rows.length === 0 && (
        <div style={{ padding: '28px 22px', color: 'var(--gv-faint)', fontSize: 13 }}>Nothing here yet.</div>
      )}
    </div>
  );
}
