'use client';
import { useState } from 'react';
import Link from 'next/link';
import Icon from './gv-icons';

const ACCENT = '#63c281';

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
  publishing: { status: 'Publishing', color: ACCENT, bg: 'rgba(99,194,129,0.1)', border: 'rgba(99,194,129,0.25)', dot: ACCENT },
  review: { status: 'In review', color: '#e0c878', bg: 'rgba(224,200,120,0.08)', border: 'rgba(224,200,120,0.22)', dot: '#e0c878' },
  live: { status: 'Live', color: '#9aa096', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', dot: '#9aa096' },
  writing: { status: 'Drafting', color: '#7fb6e6', bg: 'rgba(127,182,230,0.08)', border: 'rgba(127,182,230,0.2)', dot: '#7fb6e6' },
  failed: { status: 'Failed', color: '#c97f7f', bg: 'rgba(201,127,127,0.08)', border: 'rgba(201,127,127,0.22)', dot: '#c97f7f' },
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
    <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, overflow: 'hidden', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Content pipeline</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {tabDef.map((t) => {
              const active = tab === t.label;
              return (
                <button key={t.label} onClick={() => setTab(t.label)}
                  style={{ border: `1px solid ${active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)'}`, background: active ? 'rgba(255,255,255,0.06)' : 'transparent', color: active ? '#eef1ea' : '#9aa096', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}>
                  {t.label} <span style={{ opacity: 0.6 }}>{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Link href="/dashboard/pipeline" style={{ fontSize: 12.5, color: '#9aa096', textDecoration: 'none' }}>View all →</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, padding: '11px 22px', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#565a53', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <span>Post</span><span>Target keyword</span><span>Words</span><span>Status</span><span style={{ textAlign: 'right' }}>Schedule</span>
      </div>

      {rows.map((r) => {
        const st = ST[r.s];
        return (
          <Link key={r.id} href={`/dashboard/posts/${r.id}`} className="gv-row"
            style={{ display: 'grid', gridTemplateColumns: cols, gap: 0, alignItems: 'center', padding: '15px 22px', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background .15s', cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 18 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: r.accentIcon ? 'rgba(99,194,129,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${r.accentIcon ? 'rgba(99,194,129,0.22)' : 'rgba(255,255,255,0.07)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: r.accentIcon ? ACCENT : '#9aa096', flexShrink: 0 }}>
                <Icon name={r.icon} size={15} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: '#6b6f67' }}>{r.meta}</span>
              </span>
            </div>
            <span style={{ fontSize: 12.5, color: '#9aa096', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>{r.keyword}</span>
            <span style={{ fontSize: 12.5, color: '#cdd2c9' }}>{r.words}</span>
            <span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: st.color, background: st.bg, border: `1px solid ${st.border}`, padding: '4px 10px', borderRadius: 999 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot }} />{st.status}
              </span>
            </span>
            <span style={{ fontSize: 12.5, color: '#9aa096', textAlign: 'right' }}>{r.schedule}</span>
          </Link>
        );
      })}
      {rows.length === 0 && (
        <div style={{ padding: '28px 22px', color: '#6b6f67', fontSize: 13 }}>Nothing here yet.</div>
      )}
    </div>
  );
}
