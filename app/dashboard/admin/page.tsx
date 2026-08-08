import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isAdminEmail } from '@/lib/admin';
import { getAdminStats } from '@/lib/admin-stats';
import { detectAnomalies } from '@/lib/anomaly';
import { feedbackStats } from '@/lib/feedback-store';
import { betaStats } from '@/lib/beta-store';
import { DashHeader } from '../gv-chrome';

export const dynamic = 'force-dynamic';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'rgba(255,255,255,0.08)';
const DIM = 'var(--gv-dim)';

export default async function AdminOverviewPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const [s, flags, fb, beta] = await Promise.all([
    getAdminStats(), detectAnomalies(), feedbackStats(), betaStats(),
  ]);
  const maxRef = Math.max(1, ...s.referrals.map((r) => r.count));

  const cards = [
    { label: 'Total customers', value: s.users.total.toLocaleString(), sub: `${s.users.new7d} new this week`, href: '/dashboard/admin/users' },
    { label: 'New (30 days)', value: s.users.new30d.toLocaleString(), sub: `${s.users.new7d} in last 7d` },
    { label: 'Active subscriptions', value: s.subs.active.toLocaleString(), sub: planMix(s.subs.byPlan) },
    { label: 'MRR', value: `$${s.subs.mrrUsd.toLocaleString()}`, sub: 'from active plans' },
    { label: 'Pending refunds', value: s.refunds.pending.toLocaleString(), sub: `${s.refunds.refunded} refunded total`, href: '/dashboard/admin/refunds' },
    // The beta funnel's two ends: who is testing right now, and who has run out
    // and is therefore either about to pay or about to leave.
    { label: 'Live betas', value: beta.active.toLocaleString(), sub: `${beta.expired} expired · ${beta.committedPostsPerMonth} free posts/mo`, href: '/dashboard/admin/beta' },
    { label: 'Open feedback', value: fb.open.toLocaleString(), sub: fb.blockers ? `${fb.blockers} BLOCKING` : `${fb.publishable} ready to publish`, href: '/dashboard/admin/feedback' },
  ];

  return (
    <>
      <DashHeader title="Overview" subtitle="Customers, revenue & health at a glance" />
      <div className="gv-body">
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          {/* live anomaly flags */}
          <div style={{ marginBottom: 18 }}>
            {flags.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: ACCENT_INK, background: 'rgba(162,255,1,0.08)', border: `1px solid rgba(162,255,1,0.2)`, borderRadius: 10, padding: '10px 14px' }}>
                <span>✓</span> No anomalies in the last hour.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {flags.map((f) => {
                  const crit = f.severity === 'critical';
                  const fg = crit ? 'var(--gv-red-text)' : 'var(--gv-amber)';
                  const bg = crit ? 'rgba(255,99,99,0.1)' : 'rgba(255,255,255,0.1)';
                  const bd = crit ? 'rgba(255,99,99,0.3)' : 'rgba(255,255,255,0.3)';
                  return (
                    <div key={f.key} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 10, padding: '11px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bd, color: fg, textTransform: 'uppercase' }}>{f.severity}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--gv-ink)' }}>{f.title}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--gv-soft)', marginTop: 5 }}>{f.detail}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* metric cards */}
          {/* auto-fit rather than a fixed count: cards get added here as the
              product grows, and a hardcoded column count silently orphans the
              last row every time one does */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }} className="gv-grid5">
            {cards.map((c) => {
              const inner = (
                <>
                  <div style={{ fontSize: 12, color: DIM }}>{c.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--gv-ink)', margin: '6px 0 4px', letterSpacing: '-0.01em' }}>{c.value}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>{c.sub}</div>
                </>
              );
              return c.href ? (
                <Link key={c.label} href={c.href} className="gv-card" style={cardStyle}>{inner}</Link>
              ) : (
                <div key={c.label} className="gv-card" style={cardStyle}>{inner}</div>
              );
            })}
          </div>

          {/* two columns: referral sources + recent payments */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }} className="gv-2col">
            <Panel title="How customers found us">
              {s.referrals.length === 0 ? (
                <Empty>No signups yet.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {s.referrals.map((r) => (
                    <div key={r.source}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--gv-soft)' }}>{r.source}</span>
                        <span style={{ color: DIM }}>{r.count}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.05)' }}>
                        <div style={{ height: '100%', width: `${(r.count / maxRef) * 100}%`, borderRadius: 99, background: ACCENT }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Recent payments">
              {!s.payments.configured ? (
                <Empty>Stripe not configured — set keys to see payments.</Empty>
              ) : s.payments.recent.length === 0 ? (
                <Empty>No payments yet.</Empty>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {s.payments.recent.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < s.payments.recent.length - 1 ? `1px solid ${LINE}` : 'none' }}>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--gv-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email ?? '—'}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: p.refunded ? 'var(--gv-faint)' : 'var(--gv-ink)', textDecoration: p.refunded ? 'line-through' : 'none' }}>
                        {(p.amountCents / 100).toFixed(2)} {p.currency.toUpperCase()}
                      </span>
                      <PayBadge status={p.refunded ? 'refunded' : p.status} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* recent signups */}
          <Panel title="Recent signups" style={{ marginTop: 18 }}>
            {s.users.recent.length === 0 ? (
              <Empty>No customers yet.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: DIM, fontSize: 11.5 }}>
                      <th style={th}>Email</th><th style={th}>Plan</th><th style={th}>Source</th><th style={th}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.users.recent.map((u, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td style={{ ...td, color: 'var(--gv-ink)' }}>{u.email ?? '—'}</td>
                        <td style={td}>{u.plan ? <span style={pill}>{cap(u.plan)}</span> : <span style={{ color: 'var(--gv-fainter)' }}>free</span>}</td>
                        <td style={{ ...td, color: 'var(--gv-soft)' }}>{u.source}</td>
                        <td style={{ ...td, color: DIM }}>{new Date(u.createdAt).toLocaleDateString('en-US')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function planMix(byPlan: Record<string, number>): string {
  const parts = Object.entries(byPlan).map(([p, n]) => `${n} ${p}`);
  return parts.length ? parts.join(' · ') : 'none active';
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="gv-card" style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', ...style }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gv-ink)', marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: 'var(--gv-faint)', padding: '6px 0' }}>{children}</div>;
}
function PayBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    succeeded: { bg: 'rgba(162,255,1,0.16)', fg: ACCENT_INK },
    refunded: { bg: 'rgba(255,255,255,0.06)', fg: DIM },
    failed: { bg: 'rgba(255,99,99,0.14)', fg: 'var(--gv-red-text)' },
    pending: { bg: 'rgba(255,255,255,0.16)', fg: 'var(--gv-amber)' },
  };
  const s = map[status] ?? map.pending;
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: s.bg, color: s.fg }}>{status}</span>;
}

const cardStyle: React.CSSProperties = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 16px' };
const th: React.CSSProperties = { padding: '0 10px 8px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '10px' };
const pill: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: ACCENT_INK, background: 'rgba(162,255,1,0.12)', borderRadius: 999, padding: '2px 9px' };
