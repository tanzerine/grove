import { BUILT } from '@/lib/journey';
import type { Reached } from '@/lib/journey-store';
import JourneyCalendar from './JourneyCalendar';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'var(--gv-line)';
const DIM = 'var(--gv-dim)';
const FAINT = 'var(--gv-faint)';
const FAINTER = 'var(--gv-fainter)';

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

      {/* ── the calendar ──────────────────────────────────────────────── */}
      <JourneyCalendar />

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
