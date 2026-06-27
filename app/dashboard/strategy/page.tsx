import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { summarizeMonth, type MonthlyReport } from '@/lib/strategy/review';
import type { Strategy, Goal, Pillar, PostSlot } from '@/lib/strategy/build';
import LocalDateTime from './LocalDateTime';

type SlotStatus = { status: string; slug: string | null; scheduled_at?: string | null };

export const dynamic = 'force-dynamic';

export default async function StrategyPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: domain } = await sb
    .from('domains')
    .select('id,hostname,interview')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!domain) return <Empty />;

  const { data: strategy } = await sb
    .from('strategies')
    .select('*')
    .eq('domain_id', domain.id)
    .eq('active', true)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!strategy) return <NoStrategy hasInterview={!!domain.interview} />;

  // pull this-month's report for goal progress; fall back to zeros silently
  let report: MonthlyReport | null = null;
  try {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    report = await summarizeMonth(domain.id, from, to);
  } catch { /* noop */ }

  // posts in this strategy month, keyed for the publishing plan table
  const admin = supabaseAdmin();
  const { data: posts = [] } = await admin
    .from('posts')
    .select('id,title,slug,status,topic,published_at,scheduled_at,slot_id,research')
    .eq('domain_id', domain.id)
    .order('created_at', { ascending: false });
  // Match a slot to its post by slot_id (exact, set at materialization) and
  // fall back to topic text for older posts that predate the link column.
  const slotStatusByTopic = new Map<string, SlotStatus>();
  const slotStatusById = new Map<string, SlotStatus>();
  for (const p of posts ?? []) {
    const v: SlotStatus = { status: p.status, slug: p.slug, scheduled_at: p.scheduled_at };
    if (p.topic) slotStatusByTopic.set(p.topic.toLowerCase(), v);
    if ((p as any).slot_id) slotStatusById.set((p as any).slot_id, v);
  }
  const statusForSlot = (slot: PostSlot): SlotStatus | undefined =>
    slotStatusById.get(slot.id) ?? slotStatusByTopic.get(slot.topic.toLowerCase());

  const s = strategy as unknown as Strategy & { id: string; month: string; source: string };

  return (
    <>
      <Header strategy={s} hostname={domain.hostname} />
      <div className="gv-body">
        <div style={{ marginBottom: 6 }} />
        {s.notes && <NotesCard notes={s.notes} />}
        <GoalsRow goals={s.goals} kpis={s.kpis} report={report} />
        <PillarsList pillars={s.pillars} plan={s.publishing_plan} slotStatus={slotStatusByTopic} report={report} />
        <PublishingPlanTable plan={s.publishing_plan} pillars={s.pillars} statusFor={statusForSlot} />
      </div>
    </>
  );
}

// ───────────────────────────── HEADER ──────────────────────────────
function Header({ strategy, hostname }: { strategy: Strategy & { month: string; source: string }; hostname: string }) {
  const monthLabel = new Date(strategy.month + 'T00:00:00Z').toLocaleString(undefined, {
    month: 'long', year: 'numeric',
  });
  return (
    <header className="gv-header">
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Strategy · {monthLabel}</div>
        <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>{hostname} · the monthly plan your agent works from</div>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
        <SourceChip source={strategy.source} />
        <Link href="/onboarding/intent" className="gv-ghost" style={{ padding: '9px 15px', fontSize: 13, fontWeight: 600, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', borderRadius: 10 }}>
          Edit intent
        </Link>
      </div>
    </header>
  );
}

function SourceChip({ source }: { source: string }) {
  const labels: Record<string, string> = { inferred: 'inferred from web', interview: 'owner interview', mixed: 'interview + inferred' };
  return (
    <span
      style={{
        background: source === 'interview' ? 'rgba(108,201,138,0.18)' : 'var(--paper)',
        color: source === 'interview' ? 'var(--moss)' : 'var(--clay)',
        fontSize: 11, padding: '6px 12px', borderRadius: 999, fontFamily: 'DM Mono',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}
    >
      {labels[source] ?? source}
    </span>
  );
}

// ───────────────────────────── NOTES ───────────────────────────────
function NotesCard({ notes }: { notes: string }) {
  return (
    <div style={{ marginTop: 26, background: '#101310', border: '1px solid var(--line)', borderRadius: 14, padding: '18px 22px' }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)' }}>
        Notes vs. last month
      </div>
      <p style={{ marginTop: 8, fontSize: 15, color: 'var(--ink)', lineHeight: 1.6 }}>{notes}</p>
    </div>
  );
}

// ───────────────────────────── GOALS ───────────────────────────────
function GoalsRow({ goals, kpis, report }: { goals: Goal[]; kpis: Strategy['kpis']; report: MonthlyReport | null }) {
  if (!goals?.length) return null;
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const expectedPace = dayOfMonth / daysInMonth;

  return (
    <div style={{ marginTop: 26 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>
        Goals
      </div>
      <div className="r-goals" style={{ '--cols': Math.min(goals.length, 3) } as React.CSSProperties}>
        {goals.map((g) => {
          const kpi = kpis.find((k) => k.goal_id === g.id);
          const current = kpi ? currentMetricValue(kpi.metric, report) : 0;
          const target = kpi?.target ?? 0;
          const pct = target > 0 ? Math.min(1, current / target) : 0;
          const pace = expectedPace > 0 ? pct / expectedPace : 0;
          const verdict = pace >= 1.05 ? { label: 'ahead', color: 'var(--moss)' }
            : pace >= 0.85 ? { label: 'on pace', color: 'var(--ink)' }
            : { label: 'behind', color: '#b04a3b' };
          return (
            <div key={g.id} style={{ background: '#101310', border: '1px solid var(--line)', borderRadius: 14, padding: 20 }}>
              <div style={{ fontFamily: 'Clash Display', fontSize: 18, color: 'var(--ink)' }}>{g.title}</div>
              <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 4 }}>{g.why}</div>
              <div style={{ marginTop: 16, fontSize: 13, color: 'var(--clay)' }}>
                {prettyMetric(kpi?.metric)} → target {fmtTarget(kpi)}
              </div>
              <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'var(--paper)', overflow: 'hidden' }}>
                <div style={{ width: `${pct * 100}%`, height: '100%', background: verdict.color }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--ink)' }}>{fmtNumber(current)} / {fmtNumber(target)}</span>
                <span style={{ color: verdict.color, fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {verdict.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function currentMetricValue(metric: Strategy['kpis'][number]['metric'], report: MonthlyReport | null): number {
  if (!report) return 0;
  const t = report.totals;
  switch (metric) {
    case 'views':                   return t.views;
    case 'unique_sessions':         return t.unique_sessions;
    case 'median_dwell_sec':        return t.median_dwell_sec;
    case 'scroll_completion_rate':  return Math.round(t.scroll_completion_rate * 100);
    case 'outbound_to_product_rate':return Math.round(t.outbound_to_product_rate * 100);
    case 'conversions':             return t.conversions;
    case 'organic_share':           return Math.round(t.organic_share * 100);
    case 'newsletter_signups':      return 0; // not tracked yet
    default: return 0;
  }
}

function prettyMetric(m?: string): string {
  if (!m) return 'metric';
  return m.replace(/_/g, ' ');
}

function fmtTarget(kpi?: Strategy['kpis'][number]): string {
  if (!kpi) return '—';
  const pctMetrics = ['scroll_completion_rate', 'outbound_to_product_rate', 'organic_share'];
  return pctMetrics.includes(kpi.metric) ? `${kpi.target}%` : fmtNumber(kpi.target);
}

function fmtNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

// ───────────────────────────── PILLARS ─────────────────────────────
function PillarsList({
  pillars, plan, slotStatus, report,
}: { pillars: Pillar[]; plan: PostSlot[]; slotStatus: Map<string, SlotStatus>; report: MonthlyReport | null }) {
  if (!pillars?.length) return null;
  return (
    <div style={{ marginTop: 30 }}>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)', marginBottom: 12 }}>
        Content pillars
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {pillars.map((p) => <PillarCard key={p.id} pillar={p} plan={plan} slotStatus={slotStatus} report={report} />)}
      </div>
    </div>
  );
}

function PillarCard({
  pillar, plan, slotStatus, report,
}: { pillar: Pillar; plan: PostSlot[]; slotStatus: Map<string, SlotStatus>; report: MonthlyReport | null }) {
  const planned = plan.filter((s) => s.pillar_id === pillar.id);
  const published = planned.filter((s) => slotStatus.get(s.topic.toLowerCase())?.status === 'published').length;
  const perf = report?.per_pillar?.[pillar.id];
  const verdict = pillarVerdict(perf?.views ?? 0, planned.length, published);

  return (
    <div style={{ background: '#101310', border: '1px solid var(--line)', borderRadius: 14, padding: '20px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: 'Clash Display', fontSize: 20, color: 'var(--ink)' }}>{pillar.title}</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--clay)' }}>
          {planned.length} planned · {published} published
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--clay)', marginTop: 6 }}>
        for <strong style={{ color: 'var(--ink)' }}>{pillar.audience}</strong> — {pillar.promise}
      </div>

      <IntentBar mix={pillar.intent_mix} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 13 }}>
        <span style={{ color: 'var(--ink)' }}>
          {perf
            ? `${fmtNumber(perf.views)} views · median dwell ${Math.floor((perf.median_dwell_sec ?? 0) / 60)}:${String((perf.median_dwell_sec ?? 0) % 60).padStart(2, '0')} · ${perf.conversions} conv`
            : <span style={{ color: 'var(--clay)' }}>no analytics yet</span>}
        </span>
        <span style={{ color: verdict.color, fontFamily: 'DM Mono', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {verdict.icon} {verdict.label}
        </span>
      </div>
    </div>
  );
}

function IntentBar({ mix }: { mix: Pillar['intent_mix'] }) {
  const e = Math.round(mix.editorial * 100);
  const c = Math.round(mix.contextual * 100);
  const v = 100 - e - c;
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ height: 8, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${e}%`, background: 'var(--clay)' }} title={`${e}% editorial`} />
        <div style={{ width: `${c}%`, background: 'var(--ink)' }} title={`${c}% contextual`} />
        <div style={{ width: `${v}%`, background: 'var(--moss)' }} title={`${v}% conversion`} />
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 6, fontSize: 11, color: 'var(--clay)', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--clay)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }} />{e}% edit</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--ink)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }} />{c}% ctx</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--moss)', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }} />{v}% conv</span>
      </div>
    </div>
  );
}

function pillarVerdict(views: number, planned: number, published: number) {
  if (planned === 0) return { icon: '·', label: 'no plan', color: 'var(--clay)' };
  if (published === 0) return { icon: '○', label: 'pending', color: 'var(--clay)' };
  if (views >= 1000) return { icon: '▲', label: 'top performer · keep', color: 'var(--moss)' };
  if (views < 200 && published >= 2) return { icon: '▼', label: 'under-pacing · sharpen', color: '#b04a3b' };
  return { icon: '·', label: 'tracking', color: 'var(--ink)' };
}

// ─────────────────────── PUBLISHING PLAN TABLE ─────────────────────
function PublishingPlanTable({
  plan, pillars, statusFor,
}: { plan: PostSlot[]; pillars: Pillar[]; statusFor: (slot: PostSlot) => SlotStatus | undefined }) {
  if (!plan?.length) return null;
  const pillarTitle = (id: string) => pillars.find((p) => p.id === id)?.title ?? id;

  // Effective date for each slot: the post's actual scheduled_at (reflects any
  // reschedule) if it exists, else the planned publish_date. Sort into a schedule.
  const effectiveDate = (slot: PostSlot) => statusFor(slot)?.scheduled_at ?? slot.publish_date ?? '';
  const rows = [...plan].sort((a, b) => (effectiveDate(a) < effectiveDate(b) ? -1 : 1));

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--clay)' }}>
          Publishing plan · {plan.length} slots
        </div>
        <Link href="/dashboard/calendar" style={{ fontSize: 12, color: 'var(--moss)', textDecoration: 'none' }}>
          Open calendar →
        </Link>
      </div>
      <div style={{ background: '#101310', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--paper)' }}>
              <Th>Date</Th>
              <Th>Pillar</Th>
              <Th>Topic</Th>
              <Th>Intent</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((slot) => {
              const status = statusFor(slot);
              const date = effectiveDate(slot);
              const rescheduled = !!status?.scheduled_at && !!slot.publish_date
                && status.scheduled_at.slice(0, 10) !== slot.publish_date.slice(0, 10);
              return (
                <tr key={slot.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <Td>
                    {date
                      ? <span style={{ fontFamily: 'DM Mono', fontSize: 13, color: 'var(--ink)' }}>
                          <LocalDateTime iso={date} withTime />
                          {rescheduled && <span title="rescheduled from plan" style={{ color: 'var(--moss)', marginLeft: 6 }}>•</span>}
                        </span>
                      : <span style={{ color: 'var(--clay)' }}>—</span>}
                  </Td>
                  <Td><span style={{ color: 'var(--clay)' }}>{pillarTitle(slot.pillar_id)}</span></Td>
                  <Td>{slot.topic}</Td>
                  <Td><IntentTag intent={slot.intent} /></Td>
                  <Td><StatusTag status={status?.status ?? 'planned'} /></Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th style={{ textAlign: 'left', padding: '12px 16px', fontSize: 11, color: 'var(--moss)', fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
    {children}
  </th>
);
const Td = ({ children }: { children: React.ReactNode }) => (
  <td style={{ padding: '12px 16px', color: 'var(--ink)' }}>{children}</td>
);

function IntentTag({ intent }: { intent: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    editorial:  { bg: 'var(--paper)',                fg: 'var(--clay)' },
    contextual: { bg: 'rgba(26,46,31,0.08)',         fg: 'var(--ink)'  },
    conversion: { bg: 'rgba(108,201,138,0.20)',      fg: 'var(--moss)' },
  };
  const c = map[intent] ?? map.contextual;
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontFamily: 'DM Mono', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {intent}
    </span>
  );
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; fg: string }> = {
    published: { label: '✓ published', fg: 'var(--moss)' },
    scheduled: { label: '⊙ scheduled', fg: 'var(--ink)' },
    review:    { label: '⊙ in review', fg: 'var(--ink)' },
    writing:   { label: '… writing',  fg: 'var(--clay)' },
    researching: { label: '… research', fg: 'var(--clay)' },
    queued:    { label: '… queued',   fg: 'var(--clay)' },
    failed:    { label: '✕ failed',    fg: '#b04a3b' },
    planned:   { label: '· planned',   fg: 'var(--clay)' },
  };
  const c = map[status] ?? map.planned;
  return <span style={{ color: c.fg, fontFamily: 'DM Mono', fontSize: 12 }}>{c.label}</span>;
}

// ─────────────────────────── EMPTY STATES ──────────────────────────
function Empty() {
  return (
    <div className="gv-body" style={{ marginTop: 60, textAlign: 'center', color: '#9aa096' }}>
      <p>Connect a domain first.</p>
    </div>
  );
}

function NoStrategy({ hasInterview }: { hasInterview: boolean }) {
  return (
    <div className="gv-body"><div style={{ background: '#101310', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 14, padding: '40px 30px', textAlign: 'center' }}>
      <h3 className="display" style={{ fontSize: 22 }}>No strategy yet.</h3>
      <p style={{ color: 'var(--clay)', marginTop: 8 }}>
        {hasInterview
          ? 'Strategy will build automatically on the 1st of the month, or run a generation to seed it.'
          : 'Answer a few questions and the strategist will draft this month\'s plan.'}
      </p>
      <Link href="/onboarding/intent" className="btn btn-primary" style={{ display: 'inline-block', marginTop: 16, padding: '10px 18px' }}>
        {hasInterview ? 'Edit intent' : 'Answer 5 questions →'}
      </Link>
    </div></div>
  );
}
