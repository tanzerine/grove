import {
  BUILT, MILESTONES, PHASES, WEEKS, TOTAL_COMMITS,
  barPct, dayLabel, dayOf, milestonesInWeek, weekLabel,
} from '@/lib/journey';
import type { Reached } from '@/lib/journey-store';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'var(--gv-line)';
const DIM = 'var(--gv-dim)';
const FAINT = 'var(--gv-faint)';
const FAINTER = 'var(--gv-fainter)';

const PEAK = Math.max(...WEEKS.map((w) => w.commits));

/**
 * The journey board — presentation only, no auth and no I/O, so it renders
 * from any `Reached` shape without a session. page.tsx owns the gate and the
 * query; everything visual lives here.
 */
export default function JourneyBoard({ r }: { r: Reached }) {
  const reached = [
    { label: 'Paying customers', value: String(r.paying), note: r.granted ? `${r.granted} comped / beta` : 'no charge has ever settled' },
    { label: 'Signups who were strangers', value: String(r.users.real), note: `${r.users.total} rows · ${r.users.seeds} seeded fixtures` },
    { label: 'Beta seats taken', value: `${r.beta.redeemed} / ${r.beta.seats}`, note: 'created Aug 9 and Aug 14' },
    { label: 'Prospects contacted', value: String(r.prospects), note: '30 emails written, none sent' },
    { label: 'Feedback from outside', value: String(r.outsideFeedback), note: 'excluding my own test rows' },
  ];

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── the two ledgers ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
          <h2 style={label()}>Built</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 26px', marginTop: 14 }}>
            {BUILT.map((b) => (
              <div key={b.label}>
                <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--gv-ink)', lineHeight: 1.1 }}>{b.value}</div>
                <div style={{ fontSize: 11, color: FAINT, marginTop: 3 }}>{b.label}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: DIM, margin: '16px 0 0', lineHeight: 1.55, marginTop: 'auto', paddingTop: 16 }}>
            {r.posts.published} articles published, which earned{' '}
            <strong style={{ color: 'var(--gv-ink)', fontWeight: 600 }}>{r.search.clicks} clicks</strong>{' '}
            from {r.search.impressions.toLocaleString()} impressions
            {r.search.avgPosition !== null && <> at an average position of {r.search.avgPosition}</>}.
          </p>
        </section>

        <section style={{ background: CARD, border: '1px solid rgba(201,127,127,0.25)', borderRadius: 14, padding: '18px 20px' }}>
          <h2 style={{ ...label(), color: 'var(--gv-red-soft)' }}>Reached</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            {reached.map((x) => (
              <div key={x.label} style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <div style={{
                  fontSize: 20, fontWeight: 600, lineHeight: 1.1, minWidth: 58,
                  color: x.value.startsWith('0') ? 'var(--gv-red-text)' : 'var(--gv-ink)',
                }}>{x.value}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--gv-soft)' }}>{x.label}</div>
                  <div style={{ fontSize: 11, color: FAINTER, marginTop: 1 }}>{x.note}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: DIM, margin: '14px 0 0', lineHeight: 1.55, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
            Last sign-in by anyone but me:{' '}
            <strong style={{ color: 'var(--gv-red-text)', fontWeight: 600 }}>
              {r.users.lastOutsideSignIn ? r.users.lastOutsideSignIn.slice(0, 10) : 'never'}
            </strong>
          </p>
        </section>
      </div>

      {/* ── velocity ─────────────────────────────────────────────────────── */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={label()}>Commits per week</h2>
        <div style={{ fontSize: 11.5, color: FAINT, marginTop: 4 }}>
          {TOTAL_COMMITS} commits over {WEEKS.length} weeks. Dots mark the weeks something left the building.
        </div>

        <div style={{ overflowX: 'auto', marginTop: 18, paddingBottom: 4 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', minWidth: 640, height: 150 }}>
            {WEEKS.map((w) => {
              const pins = milestonesInWeek(w.start);
              const outward = pins.some((p) => p.outward);
              return (
                <div key={w.start} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
                  {pins.length > 0 && (
                    <div
                      title={pins.map((p) => p.label).join(' · ')}
                      style={{
                        width: 7, height: 7, borderRadius: '50%', margin: '0 auto',
                        background: outward ? ACCENT : 'var(--gv-veil-line-2)',
                      }}
                    />
                  )}
                  <div style={{ fontSize: 10.5, color: w.commits === 0 ? FAINTER : FAINT, textAlign: 'center' }}>
                    {w.commits}
                  </div>
                  <div
                    style={{
                      height: `${barPct(w.commits)}%`,
                      minHeight: w.commits === 0 ? 2 : undefined,
                      borderRadius: '4px 4px 2px 2px',
                      background: w.commits === 0
                        ? 'var(--gv-veil-line)'
                        : w.commits === PEAK ? ACCENT : 'rgba(162,255,1,0.42)',
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, minWidth: 640, marginTop: 8 }}>
            {WEEKS.map((w) => (
              <div key={w.start} style={{ flex: 1, fontSize: 9.5, color: FAINTER, textAlign: 'center', whiteSpace: 'nowrap' }}>
                {weekLabel(w.start)}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── milestones ───────────────────────────────────────────────────── */}
      <section style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px' }}>
        <h2 style={label()}>Milestones, by day</h2>
        <div style={{ fontSize: 11.5, color: FAINT, marginTop: 4, marginBottom: 14 }}>
          The cash register shipped on day {dayOf('2026-06-28')}. The meter it bills against on day {dayOf('2026-07-25')}.
          The first proof a stranger could get in at all on day {dayOf('2026-07-26')}.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {MILESTONES.map((m, i) => (
            <div
              key={`${m.label}-${i}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '9px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${LINE}`,
              }}
            >
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12, minWidth: 62,
                color: m.date ? (m.outward ? ACCENT_INK : DIM) : 'var(--gv-red-text)',
              }}>
                {dayLabel(m)}
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: m.date ? 'var(--gv-soft)' : 'var(--gv-red-soft)' }}>
                {m.label}
              </div>
              <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: FAINTER }}>
                {m.outward ? 'outward' : 'inward'}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── phases ───────────────────────────────────────────────────────── */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ ...label(), padding: '0 2px' }}>The seven stretches</h2>
        {PHASES.map((p, i) => (
          <details
            key={p.title}
            style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: '14px 18px' }}
          >
            <summary style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 11, color: FAINTER, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--gv-ink)' }}>{p.title}</span>
                <span style={{ fontSize: 11.5, color: FAINTER, marginLeft: 10 }}>
                  {weekLabel(p.from)} – {weekLabel(p.to)}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: ACCENT_INK, whiteSpace: 'nowrap' }}>{p.commits} commits</span>
            </summary>

            <p style={{ fontSize: 13, color: 'var(--gv-soft)', margin: '12px 0 0', paddingLeft: 30, lineHeight: 1.55 }}>
              {p.gist}
            </p>
            <ul style={{ margin: '10px 0 0', paddingLeft: 48, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {p.built.map((b) => (
                <li key={b} style={{ fontSize: 12.5, color: DIM, lineHeight: 1.5 }}>{b}</li>
              ))}
            </ul>
            <div style={{
              margin: '13px 0 0 30px', padding: '9px 13px',
              background: 'rgba(201,127,127,0.07)', border: '1px solid rgba(201,127,127,0.2)',
              borderRadius: 9, fontSize: 12.5, color: 'var(--gv-red-soft)', lineHeight: 1.5,
            }}>
              {p.reality}
            </div>
          </details>
        ))}
      </section>

      {/* ── the one line ─────────────────────────────────────────────────── */}
      <section style={{
        background: 'var(--gv-card-grad)', border: '1px solid rgba(162,255,1,0.2)',
        borderRadius: 14, padding: '18px 20px',
      }}>
        <h2 style={{ ...label(), color: ACCENT_INK }}>What this page is for</h2>
        <p style={{ fontSize: 13, color: 'var(--gv-soft)', margin: '10px 0 0', lineHeight: 1.6 }}>
          Every stretch above ends the same way: the work was real, and none of it was the work that
          could say no. Thirty researched leads and thirty written emails are sitting in{' '}
          <span style={{ color: 'var(--gv-ink)' }}>~/Downloads/grove_beta_30_leads.csv</span> with an
          empty <span style={{ color: 'var(--gv-ink)' }}>sent</span> column. Nothing on this page changes
          until that column does.
        </p>
      </section>

    </div>
  );
}

function label(): React.CSSProperties {
  return {
    fontSize: 10.5, letterSpacing: '0.13em', textTransform: 'uppercase',
    color: FAINTER, margin: 0, fontWeight: 500,
  };
}
