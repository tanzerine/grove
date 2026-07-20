import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isAdminEmail } from '@/lib/admin';
import { getAdminUserInsights, fmtDuration, type AdminUserRow, type EngagementStatus } from '@/lib/admin-users';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
const CARD = 'var(--gv-card)';
const LINE = 'rgba(15,23,18,0.08)';
const DIM = 'var(--gv-dim)';

export default async function AdminUsersPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');
  if (!isAdminEmail(user.email)) redirect('/dashboard');

  const now = Date.now();
  const s = await getAdminUserInsights(now);

  const cards = [
    { label: 'Active today', value: s.totals.dau.toLocaleString(), sub: 'seen since midnight UTC' },
    { label: 'Active this week', value: s.totals.wau.toLocaleString(), sub: `${pct(s.totals.wau, s.users.length)} of all users` },
    { label: 'Active this month', value: s.totals.mau.toLocaleString(), sub: `${pct(s.totals.mau, s.users.length)} of all users` },
    { label: 'Avg time in-app (7d)', value: fmtDuration(s.totals.avgSeconds7d), sub: 'per active user' },
    { label: 'Returning (30d)', value: s.totals.returning30d.toLocaleString(), sub: 'active on 2+ days' },
  ];

  const mix: { key: EngagementStatus; label: string }[] = [
    { key: 'active', label: 'Active (7d)' },
    { key: 'cooling', label: 'Cooling (7–30d)' },
    { key: 'dormant', label: 'Dormant (30d+)' },
    { key: 'never', label: 'Never seen' },
  ];
  const mixCount = (k: EngagementStatus) => s.users.filter((u) => u.status === k).length;

  const funnelSteps = [
    { label: 'Signed up', n: s.funnel.signedUp },
    { label: 'Added a site', n: s.funnel.addedSite },
    { label: 'Verified domain', n: s.funnel.verified },
    { label: 'Published a post', n: s.funnel.published },
    { label: 'Paying', n: s.funnel.paying },
  ];
  const maxFunnel = Math.max(1, s.funnel.signedUp);

  return (
    <>
      <DashHeader title="Users" subtitle="Retention, time in-app & intent — per customer" />
      <div className="gv-body">
        <div style={{ maxWidth: 1120, margin: '0 auto' }}>
          {!s.tracked && (
            <div style={{ marginBottom: 18, fontSize: 13, color: 'var(--gv-amber)', background: 'rgba(15,23,18,0.1)', border: '1px solid rgba(15,23,18,0.3)', borderRadius: 10, padding: '10px 14px' }}>
              Time-in-app tracking has no data yet (migration 0019 not applied, or no beats received).
              Until it fills in, activity here is based on sign-ins only.
            </div>
          )}

          {/* engagement cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }} className="gv-grid5">
            {cards.map((c) => (
              <div key={c.label} className="gv-card" style={cardStyle}>
                <div style={{ fontSize: 12, color: DIM }}>{c.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--gv-ink)', margin: '6px 0 4px', letterSpacing: '-0.01em' }}>{c.value}</div>
                <div style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* funnel + engagement mix */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }} className="gv-2col">
            <Panel title="Activation funnel">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {funnelSteps.map((f) => (
                  <div key={f.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: 'var(--gv-soft)' }}>{f.label}</span>
                      <span style={{ color: DIM }}>{f.n} · {pct(f.n, maxFunnel)}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: 'rgba(15,23,18,0.05)' }}>
                      <div style={{ height: '100%', width: `${(f.n / maxFunnel) * 100}%`, borderRadius: 99, background: ACCENT }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Engagement mix">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {mix.map((m) => {
                  const n = mixCount(m.key);
                  return (
                    <div key={m.key}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--gv-soft)' }}>{m.label}</span>
                        <span style={{ color: DIM }}>{n} · {pct(n, s.users.length)}</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: 'rgba(15,23,18,0.05)' }}>
                        <div style={{ height: '100%', width: `${s.users.length ? (n / s.users.length) * 100 : 0}%`, borderRadius: 99, background: statusColor(m.key).fg }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* weekly retention cohorts */}
          <Panel title="Retention by signup week" style={{ marginTop: 18 }}>
            {s.cohorts.length === 0 ? (
              <Empty>No signups in the last 8 weeks.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: DIM, fontSize: 11.5 }}>
                      <th style={th}>Cohort</th><th style={th}>Users</th>
                      {s.cohorts[0].cells.map((_, i) => <th key={i} style={{ ...th, textAlign: 'center' }}>W{i}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {s.cohorts.map((c) => (
                      <tr key={c.weekStart} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td style={{ ...td, color: 'var(--gv-soft)', whiteSpace: 'nowrap' }}>{c.weekStart}</td>
                        <td style={{ ...td, color: DIM }}>{c.size}</td>
                        {c.cells.map((v, i) => (
                          <td key={i} style={{ ...td, textAlign: 'center', padding: '6px 4px' }}>
                            {v == null ? (
                              <span style={{ color: 'var(--gv-fainter)' }}>·</span>
                            ) : (
                              <span style={{ display: 'inline-block', minWidth: 42, padding: '4px 6px', borderRadius: 7, fontWeight: 600, background: `rgba(162,255,1,${0.05 + (v / 100) * 0.3})`, color: v > 0 ? 'var(--gv-ink)' : DIM }}>
                                {v}%
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', marginTop: 10 }}>
              % of each week&apos;s signups seen again in week N. W0 is their signup week.
            </div>
          </Panel>

          {/* per-user table */}
          <Panel title={`Every customer (${s.users.length})`} style={{ marginTop: 18 }}>
            {s.users.length === 0 ? (
              <Empty>No customers yet.</Empty>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: DIM, fontSize: 11.5 }}>
                      <th style={th}>Customer</th><th style={th}>Status</th><th style={th}>Last seen</th>
                      <th style={th}>Time (7d)</th><th style={th}>Days (30d)</th><th style={th}>Source</th>
                      <th style={th}>Wants to</th><th style={th}>Sites</th><th style={th}>Posts</th><th style={th}>Plan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.users.map((u) => <UserTr key={u.id} u={u} now={now} />)}
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

function UserTr({ u, now }: { u: AdminUserRow; now: number }) {
  const c = statusColor(u.status);
  return (
    <tr style={{ borderTop: `1px solid ${LINE}` }}>
      <td style={{ ...td, maxWidth: 220 }}>
        <div style={{ color: 'var(--gv-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email ?? '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--gv-faint)' }}>joined {new Date(u.createdAt).toLocaleDateString('en-US')}</div>
      </td>
      <td style={td}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{u.status}</span>
      </td>
      <td style={{ ...td, whiteSpace: 'nowrap' }}>
        <div style={{ color: 'var(--gv-soft)' }}>{timeAgo(u.lastSeen, now)}</div>
        {u.lastPath && <div style={{ fontSize: 11, color: 'var(--gv-faint)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.lastPath.replace('/dashboard', '') || '/home'}</div>}
      </td>
      <td style={{ ...td, color: u.seconds7d ? 'var(--gv-ink)' : 'var(--gv-fainter)', whiteSpace: 'nowrap' }}>{fmtDuration(u.seconds7d)}</td>
      <td style={{ ...td, color: u.activeDays30d ? 'var(--gv-soft)' : 'var(--gv-fainter)' }}>{u.activeDays30d || '—'}</td>
      <td style={{ ...td, color: 'var(--gv-soft)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.source}</td>
      <td style={{ ...td, maxWidth: 200 }}>
        {u.goal ? (
          <>
            <div style={{ color: 'var(--gv-soft)', fontSize: 12.5 }}>{u.goal}</div>
            {u.kpi && <div style={{ fontSize: 11, color: 'var(--gv-faint)' }}>KPI: {u.kpi}</div>}
          </>
        ) : <span style={{ color: 'var(--gv-fainter)' }}>not stated</span>}
      </td>
      <td style={{ ...td, color: 'var(--gv-soft)', maxWidth: 160 }}>
        {u.sites.length === 0
          ? <span style={{ color: 'var(--gv-fainter)' }}>none</span>
          : <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{u.sites.join(', ')}{u.verifiedSites < u.sites.length ? ' (unverified)' : ''}</span>}
      </td>
      <td style={{ ...td, color: u.postsPublished ? 'var(--gv-soft)' : 'var(--gv-fainter)' }}>{u.postsPublished || '—'}</td>
      <td style={td}>{u.plan ? <span style={pill}>{cap(u.plan)}</span> : <span style={{ color: 'var(--gv-fainter)' }}>free</span>}</td>
    </tr>
  );
}

function pct(n: number, of: number): string {
  return of ? `${Math.round((n / of) * 100)}%` : '0%';
}
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function timeAgo(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US');
}

function statusColor(s: EngagementStatus): { bg: string; fg: string } {
  switch (s) {
    case 'active': return { bg: 'rgba(162,255,1,0.16)', fg: ACCENT_INK };
    case 'cooling': return { bg: 'rgba(15,23,18,0.16)', fg: 'var(--gv-amber)' };
    case 'dormant': return { bg: 'rgba(255,99,99,0.14)', fg: 'var(--gv-red-text)' };
    case 'never': return { bg: 'rgba(15,23,18,0.06)', fg: DIM };
  }
}

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

const cardStyle: React.CSSProperties = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 16px' };
const th: React.CSSProperties = { padding: '0 10px 8px', fontWeight: 500 };
const td: React.CSSProperties = { padding: '10px', verticalAlign: 'top' };
const pill: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: ACCENT_INK, background: 'rgba(162,255,1,0.12)', borderRadius: 999, padding: '2px 9px' };
