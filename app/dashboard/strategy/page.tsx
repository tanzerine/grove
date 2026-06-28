import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getActiveDomain } from '@/lib/active-domain';
import { latestSnapshot } from '@/lib/search-console/sync';
import { nearWinners } from '@/lib/search-console/insights';
import { summarizeMonth, type MonthlyReport } from '@/lib/strategy/review';
import type { Strategy, Goal, Pillar, PostSlot, KPI } from '@/lib/strategy/build';
import Icon from '../gv-icons';
import { HeaderRight } from '../gv-chrome';
import StrategyClusterMap, { type Cluster, type Spoke } from './StrategyClusterMap';

export const dynamic = 'force-dynamic';

const ACCENT = '#63c281';
const PILLAR_COLORS = [ACCENT, '#7fb6e6', '#c8a6e8', '#e0c878', '#9bb0e8', '#c97f7f'];

type SlotStatus = { status: string; slug: string | null; scheduled_at?: string | null };

export default async function StrategyPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const domain = await getActiveDomain(sb);
  if (!domain) return <Empty />;

  const { data: strategy } = await sb
    .from('strategies').select('*')
    .eq('domain_id', domain.id).eq('active', true)
    .order('month', { ascending: false }).limit(1).maybeSingle();
  if (!strategy) return <NoStrategy hasInterview={!!domain.interview} />;

  let report: MonthlyReport | null = null;
  try {
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    report = await summarizeMonth(domain.id, from, to);
  } catch { /* noop */ }

  const admin = supabaseAdmin();
  const { data: posts = [] } = await admin
    .from('posts').select('id,title,slug,status,topic,published_at,scheduled_at,slot_id,research')
    .eq('domain_id', domain.id).order('created_at', { ascending: false });

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
  const plan = s.publishing_plan ?? [];
  const planMonth = new Date(s.month + '-01T00:00:00Z').toLocaleString(undefined, { month: 'long', year: 'numeric' });

  // ---------- goals (rings) ----------
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const expectedPace = now.getUTCDate() / daysInMonth;
  const goals = (s.goals ?? []).slice(0, 4).map((g: Goal) => {
    const kpi = (s.kpis ?? []).find((k: KPI) => k.goal_id === g.id);
    const current = kpi ? currentMetricValue(kpi.metric, report) : 0;
    const target = kpi?.target ?? 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return { label: g.title, current: fmtNumber(current), target: fmtTarget(kpi), pct };
  });

  // ---------- cluster category for a slot ----------
  const catFor = (slot: PostSlot): Spoke['status'] => {
    const st = statusForSlot(slot)?.status;
    if (st === 'published') return 'published';
    if (st && ['scheduled', 'review', 'writing', 'researching', 'queued'].includes(st)) return 'planned';
    return 'gap';
  };

  // ---------- pillars (allocation) ----------
  const totalSlots = plan.length || 1;
  const pillars = (s.pillars ?? []).map((p: Pillar, i: number) => {
    const slots = plan.filter((sl) => sl.pillar_id === p.id);
    const published = slots.filter((sl) => catFor(sl) === 'published').length;
    const sharePct = Math.round((slots.length / totalSlots) * 100);
    const perf = report?.per_pillar?.[p.id];
    return {
      name: p.title, color: PILLAR_COLORS[i % PILLAR_COLORS.length],
      share: `${sharePct}%`, posts: slots.length,
      note: published ? `${published} live` : slots.length ? 'queued' : 'no slots',
      trend: perf?.views ? `${fmtNumber(perf.views)} views` : 'new',
      trendColor: perf && perf.views >= 1000 ? ACCENT : '#9aa096',
    };
  });

  // ---------- clusters per pillar (hub-and-spoke) ----------
  const clusters: Cluster[] = (s.pillars ?? []).map((p: Pillar, i: number) => {
    const slots = plan.filter((sl) => sl.pillar_id === p.id).slice(0, 7);
    const spokes: Spoke[] = slots.map((sl) => ({
      label: (sl.target_keyword ?? sl.topic).slice(0, 22),
      status: catFor(sl),
    }));
    const hub = p.title.split(/[\s&]+/)[0].slice(0, 12);
    return { hub, color: PILLAR_COLORS[i % PILLAR_COLORS.length], spokes };
  }).filter((c) => c.spokes.length);

  // ---------- plan timeline (weeks) ----------
  const INTENT: Record<string, { label: string; color: string; border: string }> = {
    editorial: { label: 'TOFU', color: '#7fb6e6', border: 'rgba(127,182,230,0.35)' },
    contextual: { label: 'MOFU', color: '#c8a6e8', border: 'rgba(200,166,232,0.35)' },
    conversion: { label: 'BOFU', color: ACCENT, border: 'rgba(99,194,129,0.35)' },
  };
  const itemStatus = (st?: string): { label: string; color: string; now: boolean } => {
    if (st === 'published') return { label: 'Live', color: ACCENT, now: false };
    if (st === 'review') return { label: 'In review', color: '#e0c878', now: false };
    if (st && ['writing', 'researching', 'queued'].includes(st)) return { label: 'Drafting', color: ACCENT, now: true };
    if (st === 'scheduled') return { label: 'Scheduled', color: '#9aa096', now: false };
    return { label: 'Planned', color: '#6b6f67', now: false };
  };
  const pillarIndex = new Map((s.pillars ?? []).map((p, i) => [p.id, i] as const));
  const effectiveDate = (slot: PostSlot) => statusForSlot(slot)?.scheduled_at ?? slot.publish_date ?? '';
  const weekBuckets: Record<number, PostSlot[]> = {};
  for (const slot of plan) {
    const d = effectiveDate(slot);
    let wk = 4;
    if (d) { const day = new Date(d).getUTCDate(); wk = Math.min(4, Math.max(1, Math.ceil(day / 7))); }
    (weekBuckets[wk] ??= []).push(slot);
  }
  const todayWeek = Math.min(4, Math.max(1, Math.ceil(now.getUTCDate() / 7)));
  const weeks = [1, 2, 3, 4].filter((w) => weekBuckets[w]?.length).map((w) => {
    const items = (weekBuckets[w] ?? []).sort((a, b) => (effectiveDate(a) < effectiveDate(b) ? -1 : 1)).slice(0, 4).map((slot) => {
      const intent = INTENT[slot.intent] ?? INTENT.contextual;
      const is = itemStatus(statusForSlot(slot)?.status);
      return {
        intent: intent.label, intentColor: intent.color, intentBorder: intent.border,
        title: slot.topic, pillarColor: PILLAR_COLORS[(pillarIndex.get(slot.pillar_id) ?? 0) % PILLAR_COLORS.length],
        status: is.label, statusColor: is.color,
        bg: is.now ? 'rgba(99,194,129,0.05)' : 'rgba(255,255,255,0.02)',
        border: is.now ? 'rgba(99,194,129,0.22)' : 'rgba(255,255,255,0.06)',
      };
    });
    const state = w < todayWeek ? 'shipped' : w === todayWeek ? 'this week' : 'planned';
    const labelColor = w === todayWeek ? ACCENT : w < todayWeek ? '#9aa096' : '#6b6f67';
    return { label: `Week ${w}`, state, labelColor, items };
  });

  // ---------- opportunities (real "page 2" queries from Search Console) ----------
  let opportunities: { tag: string; tagColor: string; tagBg: string; volume: string; title: string; why: string }[] = [];
  try {
    const snap = await latestSnapshot(domain.id);
    if (snap.date) {
      opportunities = nearWinners(snap.queries, { limit: 3 }).map((w) => ({
        tag: 'Near win', tagColor: '#06120b', tagBg: ACCENT,
        volume: `${w.impressions.toLocaleString()} impr`,
        title: w.key,
        why: `You rank #${w.position} with ${w.impressions.toLocaleString()} impressions — a stronger page can reach page one.`,
      }));
    }
  } catch { /* GSC optional — opportunities stay empty until connected */ }

  const queueable = plan.filter((sl) => catFor(sl) === 'gap').length || plan.length;
  const heroText = s.notes
    ? s.notes
    : `${planMonth}'s plan: ${plan.length} posts across ${(s.pillars ?? []).length} pillars, drafted from last month's results.`;

  return (
    <>
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Strategy</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>{domain.hostname} · the monthly plan your agent works from</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            <button className="gv-ghost" style={{ width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent', color: '#9aa096', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>‹</button>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#cdd2c9', padding: '0 10px' }}>{planMonth}</span>
            <button className="gv-ghost" style={{ width: 30, height: 30, borderRadius: 7, border: 'none', background: 'transparent', color: '#9aa096', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>›</button>
          </div>
          <Link href="/onboarding/intent" className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', textDecoration: 'none' }}>
            <Icon name="check" size={15} /> Approve plan
          </Link>
          <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.08)' }} />
          <HeaderRight />
        </div>
      </header>

      <div className="gv-body">
        {/* PLAN HERO */}
        <section className="gv-card" style={{ background: 'linear-gradient(135deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.18)', borderRadius: 20, padding: '26px 28px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 300 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: ACCENT }}>
                <Icon name="compass" size={13} /> This month&apos;s plan · auto-drafted from last month&apos;s results
              </div>
              <p style={{ fontSize: 16, lineHeight: 1.62, color: '#dfe4da', margin: '13px 0 0', maxWidth: 720 }}>{heroText}</p>
            </div>
            <div style={{ display: 'flex', gap: 9, flexShrink: 0 }}>
              <Link href="/onboarding/intent" className="gv-ghost" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '10px 15px', borderRadius: 10, cursor: 'pointer', textDecoration: 'none' }}>Edit goals</Link>
              <Link href="/dashboard/pipeline" className="gv-btn" style={{ border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' }}>Queue all {queueable} →</Link>
            </div>
          </div>
        </section>

        {/* GOAL CARDS */}
        {goals.length > 0 && (
          <div className="gv-grid4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
            {goals.map((g, i) => (
              <div key={i} className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ position: 'relative', width: 58, height: 58, flexShrink: 0 }}>
                  <Ring pct={g.pct} />
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{g.pct}%</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#9aa096' }}>{g.label}</div>
                  <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', marginTop: 3 }}>{g.current}</div>
                  <div style={{ fontSize: 11.5, color: '#6b6f67', marginTop: 1 }}>of {g.target} goal</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TWO COLUMNS: cluster map + pillars */}
        <div className="gv-2col-wide" style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 14, alignItems: 'start', marginBottom: 14 }}>
          {clusters.length > 0
            ? <StrategyClusterMap clusters={clusters} />
            : <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px', color: '#6b6f67', fontSize: 13 }}>Topical clusters appear once your plan has slots.</div>}

          {pillars.length > 0 && (
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Content pillars</div>
              <div style={{ fontSize: 12.5, color: '#6b6f67', margin: '3px 0 18px' }}>How {planMonth.split(' ')[0]}&apos;s effort is allocated</div>
              <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
                {pillars.map((p, i) => <span key={i} title={p.name} style={{ width: p.share, background: p.color }} />)}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {pillars.map((p, i) => (
                  <div key={i} className="gv-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', borderRadius: 10, transition: 'background .15s' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eef1ea', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      <div style={{ fontSize: 11.5, color: '#6b6f67', marginTop: 1 }}>{p.posts} posts · {p.note}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{p.share}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: p.trendColor }}>{p.trend}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* BOTTOM: plan timeline + opportunities */}
        <div className="gv-2col-wide" style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: 14, alignItems: 'start' }}>
          {/* plan timeline */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>The month, week by week</div>
              <span style={{ fontSize: 11.5, color: '#6b6f67' }}>{plan.length} posts · {planMonth}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {weeks.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 14 }}>
                  <div style={{ width: 64, flexShrink: 0, paddingTop: 2 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: w.labelColor }}>{w.label}</div>
                    <div style={{ fontSize: 10.5, color: '#565a53', marginTop: 2 }}>{w.state}</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {w.items.map((it, j) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 11, background: it.bg, border: `1px solid ${it.border}` }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: it.intentColor, border: `1px solid ${it.intentBorder}`, borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>{it.intent}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#cdd2c9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: it.pillarColor, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: it.statusColor, flexShrink: 0, minWidth: 64, textAlign: 'right' }}>{it.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {weeks.length === 0 && <p style={{ color: '#6b6f67', fontSize: 13, margin: 0 }}>No slots scheduled yet this month.</p>}
            </div>
          </div>

          {/* opportunities */}
          <div className="gv-card" style={{ background: 'linear-gradient(150deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.16)', borderRadius: 18, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Openings grove spotted</div>
              <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>live SERP</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#6b6f67', marginBottom: 16 }}>Queries you rank on page 2 for — ranked by upside</div>
            {opportunities.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#6b6f67', lineHeight: 1.6 }}>
                Once Search Console is connected, the near-win queries grove can push to page one show up here.{' '}
                <Link href="/dashboard/analytics" style={{ color: '#9aa096', textDecoration: 'underline' }}>Connect Search Console →</Link>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {opportunities.map((o, i) => (
                    <div key={i} style={{ padding: '13px 15px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: o.tagColor, background: o.tagBg, borderRadius: 5, padding: '2px 7px' }}>{o.tag}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#9aa096', fontVariantNumeric: 'tabular-nums' }}>{o.volume}</span>
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#eef1ea', lineHeight: 1.4 }}>{o.title}</div>
                      <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 4, lineHeight: 1.45 }}>{o.why}</div>
                    </div>
                  ))}
                </div>
                <Link href="/dashboard/write" className="gv-btn" style={{ display: 'block', textAlign: 'center', width: '100%', marginTop: 14, border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 11, borderRadius: 10, cursor: 'pointer', textDecoration: 'none' }}>Draft one of these</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Ring({ pct }: { pct: number }) {
  const r = 15.5, C = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" width={58} height={58} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={3.4} />
      <circle cx={18} cy={18} r={r} fill="none" stroke={ACCENT} strokeWidth={3.4} strokeLinecap="round"
        strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - pct / 100)).toFixed(1)}
        style={{ animation: 'gvRingIn 1.1s cubic-bezier(.4,0,.2,1)' }} />
    </svg>
  );
}

function currentMetricValue(metric: KPI['metric'], report: MonthlyReport | null): number {
  if (!report) return 0;
  const t = report.totals;
  switch (metric) {
    case 'views': return t.views;
    case 'unique_sessions': return t.unique_sessions;
    case 'median_dwell_sec': return t.median_dwell_sec;
    case 'scroll_completion_rate': return Math.round(t.scroll_completion_rate * 100);
    case 'outbound_to_product_rate': return Math.round(t.outbound_to_product_rate * 100);
    case 'conversions': return t.conversions;
    case 'organic_share': return Math.round(t.organic_share * 100);
    default: return 0;
  }
}

function fmtTarget(kpi?: KPI): string {
  if (!kpi) return '—';
  const pctMetrics = ['scroll_completion_rate', 'outbound_to_product_rate', 'organic_share'];
  return pctMetrics.includes(kpi.metric) ? `${kpi.target}%` : fmtNumber(kpi.target);
}

function fmtNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

function Empty() {
  return (
    <>
      <header className="gv-header"><div style={{ fontSize: 16, fontWeight: 700 }}>Strategy</div></header>
      <div className="gv-body" style={{ textAlign: 'center', color: '#9aa096', marginTop: 40 }}><p>Connect a domain first.</p></div>
    </>
  );
}

function NoStrategy({ hasInterview }: { hasInterview: boolean }) {
  return (
    <>
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Strategy</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>the monthly plan your agent works from</div>
        </div>
      </header>
      <div className="gv-body">
        <div style={{ background: '#101310', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 14, padding: '40px 30px', textAlign: 'center' }}>
          <h3 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>No strategy yet.</h3>
          <p style={{ color: '#9aa096', marginTop: 8 }}>
            {hasInterview
              ? 'Strategy will build automatically on the 1st of the month, or run a generation to seed it.'
              : 'Answer a few questions and the strategist will draft this month’s plan.'}
          </p>
          <Link href="/onboarding/intent" className="gv-btn" style={{ display: 'inline-block', marginTop: 16, border: 'none', background: ACCENT, color: '#06120b', fontWeight: 700, padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>
            {hasInterview ? 'Edit intent' : 'Answer 5 questions →'}
          </Link>
        </div>
      </div>
    </>
  );
}
