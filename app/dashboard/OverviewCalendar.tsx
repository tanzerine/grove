'use client';
import Link from 'next/link';
import { useState } from 'react';

export type CalEvent = {
  id: string;
  label: string;      // post title (may be long — the chip truncates it)
  status: string;     // human-readable category, e.g. "Scheduled"
  when: string;       // "Jul 12" — the day this event sits on
  color: string;
  chipBg: string;
  line: React.CSSProperties['borderStyle'];
};

export type CalDay = {
  num: number;
  numColor: string;
  bg: string;
  border: string;
  events: CalEvent[];
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The overview's mini calendar. Client-side only because of two things the
 * server version couldn't do: a real hover card (the chips truncate hard at
 * ~9 chars, and the native `title` tooltip is both slow and clipped by the
 * cell's `overflow: hidden`), and chips that link into the pipeline.
 */
export default function OverviewCalendar({ days }: { days: CalDay[] }) {
  // Hovered chip + the screen rect it occupies. `position: fixed` puts the
  // hover card above the cell's overflow clip.
  const [hover, setHover] = useState<{ ev: CalEvent; x: number; y: number } | null>(null);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--gv-fainter)', textAlign: 'center', paddingBottom: 2 }}>{w}</div>
        ))}
        {days.map((d, i) => (
          <div key={i} style={{ minHeight: 62, minWidth: 0, overflow: 'hidden', borderRadius: 9, background: d.bg, border: `1px solid ${d.border}`, padding: '6px 6px 5px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: d.numColor, alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>{d.num}</span>
            {d.events.map((ev) => (
              <Link
                key={ev.id}
                href={`/dashboard/pipeline#post-${ev.id}`}
                onMouseEnter={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setHover({ ev, x: r.left + r.width / 2, y: r.top });
                }}
                onMouseLeave={() => setHover((h) => (h?.ev.id === ev.id ? null : h))}
                onFocus={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setHover({ ev, x: r.left + r.width / 2, y: r.top });
                }}
                onBlur={() => setHover((h) => (h?.ev.id === ev.id ? null : h))}
                style={{ display: 'block', fontSize: 9.5, fontWeight: 600, lineHeight: 1.25, color: ev.color, background: ev.chipBg, borderStyle: ev.line, borderWidth: 1, borderColor: 'rgba(154,160,148,0.5)', borderRadius: 4, padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none', cursor: 'pointer' }}
              >
                {ev.label}
              </Link>
            ))}
          </div>
        ))}
      </div>

      {hover && (
        <div
          role="tooltip"
          style={{
            position: 'fixed', left: hover.x, top: hover.y - 10, transform: 'translate(-50%, -100%)',
            zIndex: 60, pointerEvents: 'none', maxWidth: 300,
            background: 'var(--gv-card)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 10,
            padding: '9px 11px', boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: hover.ev.color, marginBottom: 5 }}>
            <span style={{ width: 14, height: 8, borderRadius: 2, borderStyle: hover.ev.line, borderWidth: hover.ev.line === 'double' ? 3 : 2, borderColor: hover.ev.color }} />
            {hover.ev.status} · {hover.ev.when}
          </div>
          {/* The whole point of the hover card: the untruncated title. */}
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.4 }}>{hover.ev.label}</div>
          <div style={{ fontSize: 10.5, color: 'var(--gv-fainter)', marginTop: 6 }}>Click to open in the pipeline →</div>
        </div>
      )}
    </>
  );
}
