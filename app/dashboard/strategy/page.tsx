import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getActiveDomain } from '@/lib/active-domain';
import { summarizeMonth, type MonthlyReport } from '@/lib/strategy/review';
import type { Strategy, Goal, Pillar, PostSlot, KPI } from '@/lib/strategy/build';
import { horizons } from '@/lib/strategy/context';
import { monthKey, planIsStale, startOfMonthUTC } from '@/lib/strategy/rollover';
import { strategyBrief } from '@/lib/strategy/brief';
import { strategySteps, type StepsModel } from '@/lib/strategy/steps';
import { parseInterview } from '@/lib/strategy/interview';
import { languageForDomain } from '@/lib/language';
import Icon from '../gv-icons';
import { DashHeader } from '../gv-chrome';
import PlanChat from './PlanChat';
import PlanningCadence, { type CadenceItem, type CadenceView } from './PlanningCadence';
import PillarsAndCalendar, { type PillarCard, type CalRow, type Week } from './PillarsAndCalendar';
import StrategySteps from './StrategySteps';
import { getT } from '@/lib/i18n/server';
import { intlLocale, type T } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';
// Pillars are peer categories — whichever the domain's strategy happens to
// have, in no particular order — so no single index deserves the accent.
// A distinct hue per pillar (the .dc comp's teal→purple ramp) keeps them
// tellable apart in the allocation bar and swimlanes without leaning on lime.
const PILLAR_COLORS = ['#3de8bb', '#7fb6e6', '#c9a3e6', '#a374d6', '#e0c878', '#8fd3a6'];
const PILLAR_BORDERS = ['rgba(61,232,187,0.36)', 'rgba(127,182,230,0.32)', 'rgba(201,163,230,0.32)', 'rgba(163,116,214,0.34)', 'rgba(224,200,120,0.34)', 'rgba(143,211,166,0.34)'];
const INTENT_LABEL: Record<string, string> = { editorial: 'TOFU', contextual: 'MOFU', conversion: 'BOFU' };
const TOOL_ICON: Record<KPI['metric'], string> = {
  views: 'analytics', unique_sessions: 'analytics', median_dwell_sec: 'analytics',
  scroll_completion_rate: 'analytics', outbound_to_product_rate: 'analytics',
  conversions: 'analytics', organic_share: 'analytics', newsletter_signups: 'analytics',
};

type SlotStatus = { status: string; slug: string | null; scheduled_at?: string | null };

export default async function StrategyPage() {
  const t = await getT();
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const domain = await getActiveDomain(sb);
  if (!domain) return <Empty t={t} />;

  const { data: strategy } = await sb
    .from('strategies').select('*')
    .eq('domain_id', domain.id).eq('active', true)
    .order('month', { ascending: false }).limit(1).maybeSingle();
  const currentMonthKey = monthKey(startOfMonthUTC(new Date())).slice(0, 7);
  const currentMonthLabel = new Date(`${currentMonthKey}-01T00:00:00Z`)
    .toLocaleString(undefined, { month: 'long', year: 'numeric' });

  if (!strategy) {
    // No plan yet. The tracker still has plenty to say — which of the six
    // steps is blocked, on whom, and the one thing that unblocks it — which is
    // exactly what an empty page used to leave the owner guessing at.
    const model = strategySteps({
      profile: domain.site_profile, interview: parseInterview(domain.interview),
      verified: !!domain.verified_at, strategy: null, posts: [],
      lang: languageForDomain({ language: domain.language }).code,
    });
    return <NoStrategy t={t} model={model} domainId={domain.id} hostname={domain.hostname} currentMonth={currentMonthLabel} />;
  }

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

  // The keyword ledger (keyword_candidates, 0041): every phrase the research
  // considered for this site. Steps 3–5 of the tracker are drawn from it —
  // what was found, what was kept and at what volume/difficulty, what each
  // article's cluster is worth. Best-effort: an empty ledger (a plan from
  // before the table, or a source that could not measure) degrades every
  // panel to the plan's own keywords with no numbers, never to an error.
  let candidates: { keyword: string; source: string; volume: number | null; difficulty: number | null; intent: string | null; status: string }[] = [];
  try {
    const { data } = await admin
      .from('keyword_candidates')
      .select('keyword,source,volume,difficulty,intent,status')
      .eq('domain_id', domain.id)
      .order('volume', { ascending: false, nullsFirst: false })
      .limit(600);
    candidates = (data ?? []) as typeof candidates;
  } catch { /* the ledger is optional */ }

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
  // strategies.month is a Postgres `date`, so it comes back as "YYYY-MM-DD"
  // (e.g. "2026-07-01"). Slice to "YYYY-MM" before rebuilding the UTC date —
  // appending "-01T00:00:00Z" to a full date produced "Invalid Date".
  const planMonth = new Date(String(s.month).slice(0, 7) + '-01T00:00:00Z').toLocaleString(undefined, { month: 'long', year: 'numeric' });

  // A LIVE PLAN FROM A PAST MONTH. The active plan is read without any month
  // filter, so when this month's build fails the page happily renders LAST
  // month's calendar as if it were current — dates in the past, slots already
  // published — and BuildPlanNow only ever appeared in the "No strategy yet"
  // empty state, which a domain with any plan at all never reaches. The owner
  // whose month is actually broken was the one owner with no way to ask for it.
  // On 2026-08-01 that was www.oveners.com for a day and a half.
  // The tracker carries the flag: step 3 reopens, and "your move" becomes the
  // rebuild — one place for it instead of a banner AND an empty state.
  const stalePlan = planIsStale(s.month, new Date());

  // ---------- goals (rings) ----------
  const now = new Date();
  const daysInMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
  const goals = (s.goals ?? []).slice(0, 4).map((g: Goal) => {
    const kpi = (s.kpis ?? []).find((k: KPI) => k.goal_id === g.id);
    const current = kpi ? currentMetricValue(kpi.metric, report) : 0;
    const target = kpi?.target ?? 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    return {
      label: g.title, current: fmtNumber(current), target: fmtTarget(kpi), pct,
      toolIcon: kpi ? TOOL_ICON[kpi.metric] : 'analytics',
      note: t('first-party events'),
    };
  });

  // ---------- coverage category for a slot ----------
  const catFor = (slot: PostSlot): 'published' | 'planned' | 'gap' => {
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
    // dominant funnel intent for the pillar's card chip — majority vote across its slots
    const intentCounts = new Map<string, number>();
    for (const sl of slots) intentCounts.set(sl.intent, (intentCounts.get(sl.intent) ?? 0) + 1);
    const topIntent = [...intentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'contextual';
    const kws = slots.map((sl) => sl.target_keyword).filter((k): k is string => !!k).slice(0, 2);
    return {
      key: p.id, name: p.title, color: PILLAR_COLORS[i % PILLAR_COLORS.length], chipBorder: PILLAR_BORDERS[i % PILLAR_BORDERS.length],
      alloc: `${sharePct}%`, posts: slots.length,
      note: published ? t('{n} live', { n: published }) : slots.length ? t('queued') : t('no slots'),
      trend: perf?.views ? `${fmtNumber(perf.views)} views` : 'new',
      trendColor: perf && perf.views >= 1000 ? ACCENT : 'var(--gv-dim)',
      intent: INTENT_LABEL[topIntent] ?? 'MOFU', kws,
    };
  });

  // ---------- plan timeline (weeks) ----------
  // TOFU/MOFU are peer funnel stages, told apart by their own label text —
  // grey for both. BOFU (conversion-intent content) keeps the accent: it's
  // the highest-commercial-value stage, a deliberate "significant" call.
  const INTENT: Record<string, { label: string; color: string; border: string }> = {
    editorial: { label: 'TOFU', color: 'var(--gv-dim)', border: 'rgba(255,255,255,0.2)' },
    contextual: { label: 'MOFU', color: 'var(--gv-soft)', border: 'rgba(255,255,255,0.28)' },
    conversion: { label: 'BOFU', color: ACCENT_INK, border: 'rgba(162,255,1,0.35)' },
  };
  const itemStatus = (st?: string): { label: string; color: string; now: boolean } => {
    if (st === 'published') return { label: 'Live', color: ACCENT_INK, now: false };
    if (st === 'review') return { label: t('In review'), color: 'var(--gv-amber)', now: false };
    if (st && ['writing', 'researching', 'queued'].includes(st)) return { label: 'Drafting', color: ACCENT_INK, now: true };
    if (st === 'scheduled') return { label: 'Scheduled', color: 'var(--gv-dim)', now: false };
    return { label: 'Planned', color: 'var(--gv-faint)', now: false };
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
        bg: is.now ? 'rgba(162,255,1,0.05)' : 'rgba(255,255,255,0.02)',
        border: is.now ? 'rgba(162,255,1,0.22)' : 'rgba(255,255,255,0.06)',
      };
    });
    const state = w < todayWeek ? 'shipped' : w === todayWeek ? 'this week' : 'planned';
    // "This week" is a temporal you-are-here marker (like the calendar's
    // today cell) — text, so ACCENT_INK, not the raw lime fill token.
    const labelColor = w === todayWeek ? ACCENT_INK : w < todayWeek ? 'var(--gv-dim)' : 'var(--gv-faint)';
    return { label: t('Week {n}', { n: w }), state, labelColor, items };
  });

  // ---------- month-at-a-glance swimlanes: pillar rows × week columns ----------
  // Real status → how far the 4-stage track (research/draft/review/publish) has
  // gotten — a coarse but honest mapping from the post's actual pipeline stage.
  const trackFor = (st?: string): ('done' | 'pending')[] => {
    const d = 'done', p = 'pending';
    if (st === 'published') return [d, d, d, d];
    if (st === 'scheduled' || st === 'review') return [d, d, d, p];
    if (st === 'writing') return [d, d, p, p];
    if (st === 'researching' || st === 'queued') return [d, p, p, p];
    if (st === 'failed') return [d, p, p, p];
    return [p, p, p, p]; // no post generated yet for this slot
  };
  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const [yearStr, monthStr] = String(s.month).slice(0, 7).split('-');
  const monthIdx0 = Number(monthStr) - 1;
  const monthShort = new Date(Date.UTC(Number(yearStr), monthIdx0, 1)).toLocaleString(undefined, { month: 'short', timeZone: 'UTC' });
  const weekHeaders: Week[] = [1, 2, 3, 4].map((w) => {
    const from = (w - 1) * 7 + 1;
    const to = w === 4 ? daysInMonth : w * 7;
    return { label: t('Week {n}', { n: w }), dates: `${monthShort} ${from}–${to}` };
  });
  const calRows: CalRow[] = (s.pillars ?? []).map((p: Pillar, i: number) => {
    const slots = plan.filter((sl) => sl.pillar_id === p.id);
    const cells = [1, 2, 3, 4].map((w) =>
      slots.filter((sl) => (weekBuckets[w] ?? []).includes(sl)).slice(0, 1).map((sl) => {
        const d = effectiveDate(sl);
        return {
          day: d ? weekdayFmt.format(new Date(d)) : '—',
          title: sl.topic, kw: sl.target_keyword ?? '',
          track: trackFor(statusForSlot(sl)?.status),
        };
      }),
    );
    return { key: p.id, name: p.title, color: PILLAR_COLORS[i % PILLAR_COLORS.length], posts: slots.length, cells };
  }).filter((r) => r.cells.some((c) => c.length));

  // Where we're heading — month / week / today, derived from the plan itself.
  const hz = horizons(s, now);

  // ---------- planning cadence: monthly / weekly / daily ----------
  // This is also where the "where we're heading" horizons live: each view's
  // headline is the horizon for that window, and the bullets below it are the
  // concrete commitments — one section instead of a separate card row.
  const curWeekItems = weeks.find((w) => w.state === 'this week')?.items ?? weeks[0]?.items ?? [];
  const weekBullets: CadenceItem[] = curWeekItems.length
    ? curWeekItems.map((it): CadenceItem => ({
        label: t('Publish “{title}”', { title: it.title }), meta: it.status,
        state: it.status === 'Live' ? 'done' : it.status === 'Planned' || it.status === 'Scheduled' ? 'queued' : 'progress',
      }))
    : [{ label: t('Nothing new ships this week — existing posts keep earning.'), meta: '', state: 'queued' }];
  const cadenceViews: CadenceView[] = [
    {
      key: 'monthly', label: t('Monthly'),
      period: `${planMonth} — the full plan the agent commits to`,
      detail: hz.month.headline,
      items: goals.length
        ? goals.map((g): CadenceItem => ({
            label: g.label, meta: `${g.current} of ${g.target}`,
            state: g.pct >= 100 ? 'done' : g.pct > 0 ? 'progress' : 'queued',
          }))
        : [{ label: hz.month.detail, meta: '', state: 'queued' }],
    },
    {
      key: 'weekly', label: t('Weekly'),
      period: t('Week {n} · {month}', { n: todayWeek, month: planMonth }),
      detail: hz.week.headline,
      items: weekBullets,
    },
    {
      key: 'daily', label: t('Daily'),
      period: t('Today · {date}', { date: now.toLocaleDateString(intlLocale(t.locale), { weekday: 'long', month: 'short', day: 'numeric' }) }),
      detail: hz.today.headline,
      items: [{ label: hz.today.detail, meta: '', state: 'progress' }],
    },
  ];

  // ---------- hero: north star + plan chips + agent loop ----------
  const northStar = goals[0] ?? null;
  const planChips = [
    { value: String(plan.length), unit: t('posts'), label: t('Planned this month') },
    { value: String(pillars.length), unit: '', label: t('Content pillars') },
    { value: fmtNumber(plan.length * 1900), unit: t('words (est.)'), label: t('Estimated output') },
    ...(northStar ? [{ value: northStar.target, unit: '', label: t('Target · {goal}', { goal: northStar.label }) }] : []),
    { value: String(domain.posts_per_week ?? '—'), unit: t('/ wk'), label: t('Cadence') },
  ];

  // The hero states the *play* this month is running — deliberately not the
  // strategist's `direction.month` narrative, which the Planning-cadence card
  // already prints under "Monthly". One sentence, one job each.
  const brief = strategyBrief(s, t);

  // The six-step tracker reads the same rows as everything below it, so the
  // two can't disagree about where the month stands.
  const stepsModel: StepsModel = strategySteps({
    profile: domain.site_profile, interview: parseInterview(domain.interview),
    verified: !!domain.verified_at, strategy: s, posts: posts ?? [], candidates,
    lang: languageForDomain({ language: domain.language }).code, stale: stalePlan, now,
  });
  const pillarColorById = Object.fromEntries((s.pillars ?? []).map((p, i) => [p.id, PILLAR_COLORS[i % PILLAR_COLORS.length]]));

  return (
    <>
      <DashHeader title={t('Strategy')} subtitle={t("{host} · the agent's plan for {month}", { host: domain.hostname, month: planMonth })} />

      <div className="gv-body">
        {/* ===== HOW THE PLAN IS BUILT — the six steps, live ===== */}
        <StrategySteps
          model={stepsModel}
          domainId={domain.id}
          hostname={domain.hostname}
          planMonth={planMonth}
          currentMonth={currentMonthLabel}
          pillarColors={pillarColorById}
        />

        {/* ===== HERO BRIEF ===== */}
        <section className="gv-card" style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(162,255,1,0.18)', borderRadius: 18, padding: '26px 28px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 28, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 320 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gv-dim)' }}>
                <Icon name="leaf" size={13} /> {t('Marketing agent')} · {planMonth} strategy
              </div>
              <h1 style={{ fontWeight: 500, fontSize: 27, lineHeight: 1.3, letterSpacing: '-0.02em', color: 'var(--gv-ink)', margin: '14px 0 0', maxWidth: 720 }}>
                {brief.headline}
              </h1>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--gv-faint)', margin: '10px 0 0', maxWidth: 700 }}>{brief.summary}</p>
              {brief.note && (
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--gv-dim)', margin: '8px 0 0', maxWidth: 700 }}>{brief.note}</p>
              )}
              {northStar && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginTop: 16, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12 }}>
                  <span style={{ display: 'flex', color: 'var(--gv-soft)' }}><Icon name="target" size={16} /></span>
                  <span style={{ fontSize: 12.5, color: 'var(--gv-dim)' }}>{t('North star')}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)' }}>{northStar.target}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--gv-faint)' }}>{northStar.label}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-end' }}>
              <Link href="/dashboard/pipeline" className="gv-btn" style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: ACCENT, color: 'var(--gv-on-accent)', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, padding: '12px 20px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                <Icon name="strategy" size={15} /> {t('Open the pipeline')}
              </Link>
              <Link href="/onboarding/intent" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                {t('Edit goals')} <Icon name="arrow" size={14} />
              </Link>
            </div>
          </div>
          {planChips.length > 0 && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {planChips.map((c, i) => (
                <div key={i} style={{ flex: 1, minWidth: 130, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 13, padding: '12px 15px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>{c.value}</span>
                    {c.unit && <span style={{ fontSize: 12, color: 'var(--gv-dim)', fontWeight: 600 }}>{c.unit}</span>}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--gv-fainter)', marginTop: 3 }}>{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Talking to the strategist belongs to the brief it changes — ask
              about this plan, or revise it, without leaving the card. */}
          <div id="plan-chat" style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)', scrollMarginTop: 84 }}>
            <PlanChat domainId={domain.id} bare />
          </div>
        </section>

        {/* ===== PLANNING CADENCE ===== */}
        <PlanningCadence views={cadenceViews} />

        {/* ===== OKRs =====
             The "how grove will execute" toolchain that used to sit beside
             this card now lives inside step 6 of the tracker above. */}
        {goals.length > 0 && (
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t('Objective & key results')}</div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', margin: '3px 0 18px' }}>{t('How this month\'s plan is tracking against its targets')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {goals.map((g, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--gv-soft)', flex: 1, minWidth: 0 }}>{g.label}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--gv-faint)', fontVariantNumeric: 'tabular-nums' }}>{g.current}</span>
                    <span style={{ display: 'flex', color: '#4a4d44' }}><Icon name="arrow" size={12} /></span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--gv-ink)', fontVariantNumeric: 'tabular-nums' }}>{g.target}</span>
                  </div>
                  <div style={{ position: 'relative', height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${g.pct}%`, borderRadius: 99, background: ACCENT }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, fontSize: 11, color: 'var(--gv-faint)' }}>
                    <span style={{ display: 'flex', color: 'var(--gv-fainter)' }}><Icon name={g.toolIcon} size={12} /></span> {t('Tracked by Analytics')} · {g.note}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== CONTENT PILLARS + MONTH CALENDAR ===== */}
        {pillars.length > 0 && (
          <PillarsAndCalendar
            pillars={pillars}
            rows={calRows}
            weeks={weekHeaders}
            footNote={t('{posts} posts mapped across {pillars} pillars — approve changes any time in the chat below.', { posts: plan.length, pillars: pillars.length })}
          />
        )}

      </div>
    </>
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

function Empty({ t }: { t: T }) {
  return (
    <>
      <DashHeader title={t('Strategy')} />
      <div className="gv-body" style={{ textAlign: 'center', color: 'var(--gv-dim)', marginTop: 40 }}><p>{t('Connect a domain first.')}</p></div>
    </>
  );
}

function NoStrategy({
  model, domainId, hostname, currentMonth, t,
}: { model: StepsModel; domainId: string; hostname: string; currentMonth: string; t: T }) {
  // No plan yet, so the tracker IS the page: it shows which step the domain is
  // stuck on (verify → answer → build), who it's waiting for, and the one
  // action that moves it — the same "your move" box a live plan gets, so the
  // owner learns the page's shape before there is anything else on it.
  return (
    <>
      <DashHeader title={t('Strategy')} subtitle={t('the monthly plan your agent works from')} />
      <div className="gv-body">
        <StrategySteps model={model} domainId={domainId} hostname={hostname} planMonth={null} currentMonth={currentMonth} pillarColors={{}} />
      </div>
    </>
  );
}
