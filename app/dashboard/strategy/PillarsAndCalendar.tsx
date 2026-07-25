'use client';
/**
 * Content pillars (card grid) + the month-at-a-glance swimlane calendar
 * (Grove Strategy .dc comp). Clicking a pillar card focuses it — dimming the
 * rest of the grid and every other pillar's calendar row — so the two need
 * shared state, hence one client component for both.
 */
import { useState } from 'react';
import Icon from '../gv-icons';

export type PillarCard = {
  key: string; name: string; color: string; chipBorder: string;
  alloc: string; posts: number; intent: string; kws: string[];
};
export type CalItem = { day: string; title: string; kw: string; track: ('done' | 'pending')[] };
export type CalRow = { key: string; name: string; color: string; posts: number; cells: CalItem[][] };
export type Week = { label: string; dates: string };

const TRACK_STAGES = [
  { name: 'Research', icon: 'search2' },
  { name: 'Draft', icon: 'pen' },
  { name: 'Review', icon: 'manager' },
  { name: 'Publish', icon: 'publish' },
];

export default function PillarsAndCalendar({
  pillars, rows, weeks, footNote,
}: { pillars: PillarCard[]; rows: CalRow[]; weeks: Week[]; footNote: string }) {
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <>
      {/* ===== CONTENT PILLARS ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 2px 12px' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Content pillars</span>
        <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>where the month&apos;s writing is aimed</span>
        {focus && (
          <button onClick={() => setFocus(null)} className="gv-ghost"
            style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, color: 'var(--gv-dim)', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', borderRadius: 999, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Clear focus ✕
          </button>
        )}
      </div>
      <div className="gv-grid4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 }}>
        {pillars.map((p) => {
          const on = focus === p.key;
          return (
            <button key={p.key} className="gv-pillar" onClick={() => setFocus((f) => (f === p.key ? null : p.key))}
              style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', background: on ? `${p.color}14` : 'var(--gv-card)', border: `1px solid ${on ? p.chipBorder : 'var(--gv-line)'}`, borderRadius: 16, padding: '18px 18px 16px', opacity: focus && !on ? 0.45 : 1, transition: 'opacity .2s, border-color .2s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gv-ink)', lineHeight: 1.25 }}>{p.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, margin: '14px 0 2px' }}>
                <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--gv-ink)' }}>{p.alloc}</span>
                <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>of effort · {p.posts} post{p.posts === 1 ? '' : 's'}</span>
              </div>
              <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', margin: '10px 0 14px' }}>
                <div style={{ height: '100%', width: p.alloc, borderRadius: 99, background: p.color }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: p.color, border: `1px solid ${p.chipBorder}`, borderRadius: 6, padding: '2px 7px' }}>{p.intent}</span>
                {p.kws.map((kw, i) => (
                  <span key={i} style={{ fontSize: 11, color: 'var(--gv-dim)', background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{kw}</span>
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* ===== MONTH CALENDAR ===== */}
      <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px 24px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <span style={{ display: 'flex', color: 'var(--gv-soft)' }}><Icon name="calendar" size={16} /></span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>The month at a glance</span>
          <span style={{ fontSize: 12, color: 'var(--gv-faint)' }}>each card shows the tools the agent runs to ship it</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {TRACK_STAGES.map((s) => (
              <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--gv-dim)' }}>
                <span style={{ display: 'flex', color: 'var(--gv-faint)' }}><Icon name={s.icon} size={12} /></span>{s.name}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `188px repeat(${weeks.length || 1}, minmax(0, 1fr))`, gap: 10, marginBottom: 10 }}>
          <span />
          {weeks.map((w) => (
            <div key={w.label} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gv-soft)' }}>{w.label}</div>
              <div style={{ fontSize: 10.5, color: 'var(--gv-faint)', marginTop: 1 }}>{w.dates}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => {
            const on = !focus || focus === r.key;
            return (
              <div key={r.key} style={{ display: 'grid', gridTemplateColumns: `188px repeat(${weeks.length || 1}, minmax(0, 1fr))`, gap: 10, alignItems: 'stretch', opacity: on ? 1 : 0.4, transition: 'opacity .2s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderLeft: `3px solid ${r.color}`, borderRadius: 10 }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--gv-soft)', lineHeight: 1.25 }}>{r.name}</span>
                    <span style={{ display: 'block', fontSize: 10.5, color: 'var(--gv-faint)', marginTop: 2 }}>{r.posts} post{r.posts === 1 ? '' : 's'}</span>
                  </span>
                </div>
                {r.cells.map((items, ci) => (
                  <div key={ci} style={{ minHeight: 96, background: 'rgba(255,255,255,0.015)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 11, padding: 6 }}>
                    {items.map((it, ii) => (
                      <div key={ii} className="gv-post" style={{ height: '100%', background: '#1a1c19', border: '1px solid rgba(255,255,255,0.08)', borderLeft: `3px solid ${r.color}`, borderRadius: 9, padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: r.color, fontVariantNumeric: 'tabular-nums' }}>{it.day}</span>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.32 }}>{it.title}</div>
                        {it.kw && <div style={{ fontSize: 10.5, color: 'var(--gv-faint)', marginTop: -2 }}>{it.kw}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 1, marginTop: 'auto', paddingTop: 4, width: '100%' }}>
                          {it.track.map((st, si) => (
                            <span key={si} style={{ display: 'contents' }}>
                              <span title={TRACK_STAGES[si].name} style={{ width: 16, height: 16, minWidth: 0, borderRadius: 5, background: st === 'done' ? 'rgba(162,255,1,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${st === 'done' ? 'rgba(162,255,1,0.3)' : 'rgba(255,255,255,0.12)'}`, color: st === 'done' ? 'var(--gv-accent-ink)' : 'var(--gv-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 1 }}>
                                <Icon name={TRACK_STAGES[si].icon} size={9} />
                              </span>
                              {si < it.track.length - 1 && <span style={{ color: '#4a4d44', fontSize: 7, display: 'flex', flexShrink: 0 }}><Icon name="chevR" size={7} /></span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12, color: 'var(--gv-faint)' }}>
          <span style={{ color: 'var(--gv-faint)', display: 'flex' }}><Icon name="leaf" size={13} /></span>
          {footNote}
        </div>
      </div>
    </>
  );
}
