import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { summarizeMonth, type MonthlyReport } from '@/lib/strategy/review';
import RangePicker from './RangePicker';

export const dynamic = 'force-dynamic';

type SP = { range?: string };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = sp?.range ?? 'this_month';

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains').select('id,hostname')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!domain) return <Empty />;

  const { from, to, label } = bounds(range);
  let report: MonthlyReport | null = null;
  try {
    report = await summarizeMonth(domain.id, from, to);
  } catch { /* noop */ }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--clay)' }}>ANALYTICS</div>
          <h2 className="display" style={{ fontSize: 32, marginTop: 6 }}>{label}</h2>
        </div>
        <RangePicker current={range} />
      </div>

      {!report || report.totals.unique_sessions === 0 ? <EmptyState /> : (
        <>
          <Totals report={report} />
          <TopPosts report={report} hostname={domain.hostname} />
          <SideBySide>
            <Referrers report={report} />
            <Queries report={report} />
          </SideBySide>
        </>
      )}
    </>
  );
}

function bounds(range: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (range === 'last_month') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from, to, label: from.toLocaleString(undefined, { month: 'long', year: 'numeric' }) };
  }
  if (range === 'last_30') {
    const to = now;
    const from = new Date(Date.now() - 30 * 86400_000);
    return { from, to, label: 'Last 30 days' };
  }
  // default: this month
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to, label: from.toLocaleString(undefined, { month: 'long', year: 'numeric' }) };
}

function Totals({ report }: { report: MonthlyReport }) {
  const t = report.totals;
  const fmtDwell = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <div className="r-stats" style={{ marginTop: 26 }}>
      <Stat label="Views" value={fmtNum(t.views)} />
      <Stat label="Unique sessions" value={fmtNum(t.unique_sessions)} />
      <Stat label="Median dwell" value={fmtDwell(t.median_dwell_sec)} />
      <Stat label="Scroll-100" value={`${Math.round(t.scroll_completion_rate * 100)}%`} />
      <Stat label="Conversions" value={fmtNum(t.conversions)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'white', padding: 18, borderRadius: 14, border: '1px solid var(--line)' }}>
      <div style={{ fontFamily: 'Clash Display', fontSize: 28, color: 'var(--moss)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--clay)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function TopPosts({ report, hostname }: { report: MonthlyReport; hostname: string }) {
  if (!report.top_posts?.length) return null;
  return (
    <div style={{ marginTop: 30 }}>
      <SectionLabel>Top posts</SectionLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--paper)' }}>
              <Th>Title</Th><Th>Views</Th><Th>Dwell</Th><Th>Scroll-100</Th><Th>Conv</Th>
            </tr>
          </thead>
          <tbody>
            {report.top_posts.map((p) => (
              <tr key={p.post_id} style={{ borderTop: '1px solid var(--line)' }}>
                <Td>{p.title}</Td>
                <Td>{fmtNum(p.views)}</Td>
                <Td>{p.median_dwell_sec ? `${Math.floor(p.median_dwell_sec / 60)}:${String(p.median_dwell_sec % 60).padStart(2, '0')}` : '—'}</Td>
                <Td>{`${Math.round(p.scroll_100_rate * 100)}%`}</Td>
                <Td>{p.conversions}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SideBySide({ children }: { children: React.ReactNode[] }) {
  return (
    <div className="r-two" style={{ marginTop: 30 }}>
      {children}
    </div>
  );
}

function Referrers({ report }: { report: MonthlyReport }) {
  return (
    <div>
      <SectionLabel>Referrers</SectionLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '6px 0' }}>
        {report.top_referrers.length === 0 && (
          <div style={{ padding: '14px 18px', color: 'var(--clay)', fontSize: 13 }}>No referrers yet — mostly direct traffic.</div>
        )}
        {report.top_referrers.map((r) => (
          <div key={r.host} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 18px', borderTop: '1px solid var(--line)', fontSize: 14 }}>
            <span style={{ color: 'var(--ink)' }}>{r.host}</span>
            <span style={{ color: 'var(--clay)' }}>{Math.round(r.share * 100)}% · {r.sessions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Queries({ report }: { report: MonthlyReport }) {
  return (
    <div>
      <SectionLabel>Search queries</SectionLabel>
      <div style={{ background: 'white', border: '1px solid var(--line)', borderRadius: 14, padding: '6px 0' }}>
        {report.top_queries.length === 0 && (
          <div style={{ padding: '14px 18px', color: 'var(--clay)', fontSize: 13 }}>No search queries captured yet. Most engines strip these from referrers.</div>
        )}
        {report.top_queries.map((q) => (
          <div key={q.query} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 18px', borderTop: '1px solid var(--line)', fontSize: 14 }}>
            <span style={{ color: 'var(--ink)' }}>{q.query}</span>
            <span style={{ color: 'var(--clay)' }}>{q.sessions}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ marginTop: 26, background: 'white', border: '1px dashed var(--line)', borderRadius: 14, padding: '40px 30px', textAlign: 'center', color: 'var(--clay)' }}>
      No events yet for this range. Publish a post and check back in a day.
    </div>
  );
}

function Empty() {
  return <p style={{ color: 'var(--clay)' }}>Connect a domain first.</p>;
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>
    {children}
  </div>
);
const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, color: 'var(--moss)', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
    {children}
  </th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: '12px 16px', color: 'var(--ink)' }}>{children}</td>
);

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
