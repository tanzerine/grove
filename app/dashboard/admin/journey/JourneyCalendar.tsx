import {
  allDays, dayNumber, isWeekend, longestSilence, monthLabel, weekdayOf,
  type Day,
} from '@/lib/journey-days';
import { dayOf } from '@/lib/journey';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'var(--gv-line)';
const DIM = 'var(--gv-dim)';
const FAINT = 'var(--gv-faint)';
const FAINTER = 'var(--gv-fainter)';

const COL = 132;   // one day
const GAP = 6;

/**
 * The calendar: one column per day, left to right, scrolled sideways.
 *
 * Two decisions carry it. Every day gets a column, including the ones where
 * nothing happened — the ten blank columns of Aug 16–25 are the clearest thing
 * on the page, and a calendar that skipped them would show a steady grind. And the columns are a FIXED width rather than sized by output,
 * because widening the busy days is flattery: it makes June look like most of
 * the project when June is a quarter of it.
 *
 * The skyline strip above each column is the commit count, scaled to the
 * busiest day. It is the only place output is drawn to scale.
 */
export default function JourneyCalendar() {
  const days = allDays();
  const peak = Math.max(...days.map((d) => d.commits));
  const silence = longestSilence(days);
  const quiet = days.filter((d) => d.commits === 0).length;

  return (
    <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 0 14px' }}>
      <div style={{ padding: '0 20px' }}>
        <h2 style={{ fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase', color: FAINTER, margin: 0, fontWeight: 500 }}>
          Every day, Jun 1 → Sep 4
        </h2>
        <div style={{ fontSize: 11.5, color: FAINT, marginTop: 4 }}>
          {days.length} days · {quiet} of them with no commit at all
          {silence && silence.length > 2 && (
            <> · longest silence {silence.length} days, {monthLabel(silence.from)} {dayNumber(silence.from)}–{dayNumber(silence.to)}</>
          )}
          {' '}· scroll sideways →
        </div>
      </div>

      {/* .gv-scroll is the app's existing thin dark scrollbar — the default one
          renders as a bright white slab across the bottom of a dark card. */}
      <div className="gv-scroll" style={{ overflowX: 'auto', marginTop: 16, padding: '0 20px 6px' }}>
        <div style={{ display: 'flex', gap: GAP, alignItems: 'stretch', width: 'max-content' }}>
          {days.map((d) => (
            <DayColumn key={d.date} d={d} peak={peak} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DayColumn({ d, peak }: { d: Day; peak: number }) {
  const empty = d.commits === 0 && d.did.length === 0 && !d.note;
  const weekend = isWeekend(d.date);
  const firstOfMonth = dayNumber(d.date) === 1;
  // Scrolled into the middle of July, a bare "17" says nothing about which
  // month you are in. The 1st is too rare an anchor across 96 columns, so
  // every Monday repeats the month too — quietly, without the accent.
  const showsMonth = firstOfMonth || weekdayOf(d.date) === 'Mon';

  return (
    <div
      style={{
        width: COL, flex: `0 0 ${COL}px`,
        display: 'flex', flexDirection: 'column',
        // The month break is a real border, not a gap: sideways, a gap alone
        // reads as one more quiet day.
        borderLeft: firstOfMonth ? `1px solid rgba(162,255,1,0.28)` : '1px solid transparent',
        paddingLeft: firstOfMonth ? 8 : 0,
      }}
    >
      {/* skyline — the only thing drawn to scale */}
      <div style={{ height: 34, display: 'flex', alignItems: 'flex-end', marginBottom: 6 }}>
        {d.commits > 0 && (
          <div
            title={`${d.commits} commits`}
            style={{
              width: '100%',
              height: `${Math.max(6, Math.round((d.commits / peak) * 100))}%`,
              background: d.commits >= peak * 0.75 ? ACCENT : 'rgba(162,255,1,0.36)',
              borderRadius: '3px 3px 1px 1px',
            }}
          />
        )}
      </div>

      {/* date head */}
      <div
        style={{
          display: 'flex', alignItems: 'baseline', gap: 6,
          paddingBottom: 6, borderBottom: `1px solid ${LINE}`,
          opacity: empty ? 0.4 : 1,
        }}
      >
        <span style={{
          fontSize: 12, fontWeight: 600,
          color: firstOfMonth ? ACCENT_INK : weekend ? FAINTER : 'var(--gv-ink)',
        }}>
          {showsMonth && <span style={{ color: firstOfMonth ? ACCENT_INK : FAINTER }}>{monthLabel(d.date)} </span>}
          {dayNumber(d.date)}
        </span>
        <span style={{ fontSize: 9.5, color: FAINTER, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {weekdayOf(d.date)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: FAINTER }}>
          d{dayOf(d.date)}
        </span>
      </div>

      {/* what happened */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingTop: 8, flex: 1 }}>
        {d.did.map((line) => (
          <div key={line} style={{ fontSize: 10.5, lineHeight: 1.4, color: DIM }}>
            {line}
          </div>
        ))}

        {d.note && (
          <div style={{
            marginTop: d.did.length ? 4 : 0,
            padding: '6px 7px',
            background: d.mark === 'out' ? 'rgba(201,127,127,0.09)' : 'var(--gv-veil)',
            border: `1px solid ${d.mark === 'out' ? 'rgba(201,127,127,0.24)' : LINE}`,
            borderRadius: 7,
            fontSize: 10, lineHeight: 1.4,
            color: 'var(--gv-red-soft)',
          }}>
            {d.note}
          </div>
        )}

        {empty && (
          <div style={{ fontSize: 10.5, color: 'var(--gv-veil-line-2)', letterSpacing: '0.1em' }}>·</div>
        )}
      </div>

      {d.mark && (
        <div
          style={{
            marginTop: 8, height: 3, borderRadius: 2,
            background: d.mark === 'out' ? ACCENT : 'var(--gv-veil-line-2)',
          }}
          title={d.mark === 'out' ? 'reached someone outside' : 'inward milestone'}
        />
      )}
    </div>
  );
}
