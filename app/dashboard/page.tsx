import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { getBriefStats, composeBrief, type BriefStats } from '@/lib/agent-brief';
import { latestSnapshot } from '@/lib/search-console/sync';
import { summarize as gscSummarize } from '@/lib/search-console/insights';
import Icon from './gv-icons';
import { DashHeader } from './gv-chrome';
import OverviewPipeline, { type OvRow } from './OverviewPipeline';

const ACCENT = '#63c281';
const SAGE = '#9aa79e';
const SAGE_DOT = '#8ea596';

// Calendar event categories (matches the design's ES map).
const ES: Record<string, { color: string; chipBg: string; name: string }> = {
  published: { color: SAGE, chipBg: 'rgba(255,255,255,0.05)', name: 'Published' },
  scheduled: { color: '#9bb0e8', chipBg: 'rgba(123,158,240,0.12)', name: 'Scheduled' },
  review: { color: '#e0c878', chipBg: 'rgba(224,200,120,0.12)', name: 'In review' },
  draft: { color: '#7fb6e6', chipBg: 'rgba(127,182,230,0.12)', name: 'Draft' },
};

function categoryFor(status: string): keyof typeof ES {
  if (status === 'published') return 'published';
  if (status === 'scheduled') return 'scheduled';
  if (status === 'review') return 'review';
  return 'draft';
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = ms / 60000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  const d = h / 24;
  if (d < 2) return 'Yesterday';
  if (d < 7) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function schedLabel(p: any): string {
  if (p.status === 'published' && p.published_at) return relTime(p.published_at);
  if (p.status === 'scheduled' && p.scheduled_at) {
    const ms = new Date(p.scheduled_at).getTime() - Date.now();
    if (ms > 0 && ms < 86400000) return `in ${Math.max(1, Math.round(ms / 3600000))}h`;
    return new Date(p.scheduled_at).toLocaleDateString(undefined, { weekday: 'short' });
  }
  if (p.status === 'review') return 'Hold';
  return '—';
}

export default async function OverviewPage() {
  const sb = await supabaseServer();
  const domain = await getActiveDomain(sb);
  const { data: posts } = await sb
    .from('posts').select('*').eq('domain_id', domain?.id).order('created_at', { ascending: false }).limit(60);
  const all = posts ?? [];

  let brief: BriefStats | null = null;
  if (domain) { try { brief = await getBriefStats(domain.id, domain.hostname); } catch { /* optional */ } }

  const published = all.filter((p) => p.status === 'published');
  const inReview = all.filter((p) => p.status === 'review');
  const inPipeline = all.filter((p) => !['published', 'failed', 'archived'].includes(p.status));

  // ---- Search Console visibility (real ranking + click data once connected) ----
  let gscVis: ReturnType<typeof gscSummarize> | null = null;
  if (domain) {
    try {
      const snap = await latestSnapshot(domain.id);
      if (snap.date) gscVis = gscSummarize(snap.pages, snap.queries);
    } catch { /* GSC optional */ }
  }

  // ---- stat cards (all real; zeros/empty for a brand-new account) ----
  const totalReads = published.reduce((a, p) => a + (p.reads ?? 0), 0);
  const organicClicks = gscVis?.clicks ?? totalReads;
  const readsDelta = brief && brief.readsLastWeek > 0
    ? Math.round(((brief.readsThisWeek - brief.readsLastWeek) / brief.readsLastWeek) * 100) : null;
  const publishedCount = brief?.totalPublished ?? published.length;
  const stats = [
    {
      icon: 'rankings', label: gscVis ? 'Search clicks' : 'Total reads', value: fmtNum(organicClicks),
      delta: readsDelta !== null && Math.abs(readsDelta) >= 1 ? `${readsDelta >= 0 ? '▲' : '▼'} ${Math.abs(readsDelta)}%` : '',
      deltaColor: (readsDelta ?? 0) >= 0 ? ACCENT : '#c97f7f',
      sub: brief && brief.readsThisWeek ? `${brief.readsThisWeek} reads this week` : organicClicks ? 'all time' : 'no reads yet',
    },
    {
      icon: 'published', label: 'Posts published', value: String(publishedCount),
      delta: brief?.publishedThisWeek ? `+${brief.publishedThisWeek}` : '', deltaColor: ACCENT,
      sub: domain ? `${domain.posts_per_week ?? 4} / week on autopilot` : '—',
    },
    {
      icon: 'pipeline', label: 'In pipeline', value: String(inPipeline.length),
      delta: inPipeline.length ? 'live' : '', deltaColor: '#9aa096',
      sub: inReview.length ? `${inReview.length} awaiting review` : inPipeline.length ? 'running on schedule' : 'queue a topic to begin',
    },
    {
      icon: 'clock', label: 'Awaiting review', value: String(inReview.length),
      delta: inReview.length ? 'action' : 'clear', deltaColor: inReview.length ? '#e0c878' : '#9aa096',
      sub: inReview.length ? 'approve to publish' : 'nothing waiting on you',
    },
  ];

  // ---- compact publishing calendar (current month, real events) ----
  const now = new Date();
  const calYear = now.getFullYear(), calMonthIdx = now.getMonth(), todayNum = now.getDate();
  const calMonth = now.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calLegend = (['published', 'scheduled', 'review', 'draft'] as const).map((k) => ({ label: ES[k].name, color: ES[k].color }));

  const eventsByDay: Record<number, { s: keyof typeof ES; label: string }[]> = {};
  for (const p of all) {
    const iso = p.published_at ?? p.scheduled_at;
    if (!iso) continue;
    const d = new Date(iso);
    if (d.getFullYear() !== calYear || d.getMonth() !== calMonthIdx) continue;
    const day = d.getDate();
    (eventsByDay[day] ??= []).push({ s: categoryFor(p.status), label: p.title ?? p.topic ?? 'Post' });
  }

  const firstWeekday = new Date(calYear, calMonthIdx, 1).getDay();
  const daysInMonth = new Date(calYear, calMonthIdx + 1, 0).getDate();
  const prevDays = new Date(calYear, calMonthIdx, 0).getDate();
  const cells: { num: number; out: boolean }[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ num: prevDays - firstWeekday + 1 + i, out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ num: d, out: false });
  while (cells.length % 7 !== 0) cells.push({ num: cells.length - (firstWeekday + daysInMonth) + 1, out: true });
  const calDays = cells.map((c) => {
    const isToday = !c.out && c.num === todayNum;
    const evs = (!c.out && eventsByDay[c.num]) ? eventsByDay[c.num].map((e) => ({ label: e.label, full: `${ES[e.s].name} · ${e.label}`, color: ES[e.s].color, chipBg: ES[e.s].chipBg })) : [];
    return {
      num: c.num,
      numColor: c.out ? '#3a4640' : isToday ? ACCENT : '#9aa096',
      bg: c.out ? 'transparent' : 'rgba(255,255,255,0.015)',
      border: c.out ? 'transparent' : isToday ? ACCENT : 'rgba(255,255,255,0.05)',
      events: evs,
    };
  });

  // ---- agent panel ----
  const agentSummary = brief ? composeBrief(brief).slice(0, 2).join(' ')
    : all.length
    ? 'I’m working through your plan — researching, drafting, and holding finished drafts for your sign-off.'
    : 'Ready to go. Queue your first topic (or flip on autopilot) and I’ll start researching and drafting right away.';
  // Real insight from the data we have (top performer / review backlog) — or null.
  const agentInsight = brief?.topPost
    ? `“${brief.topPost.title}” is your top performer with ${brief.topPost.views} reads — grove can build a content cluster around it.`
    : inReview.length
    ? `${inReview.length} draft${inReview.length === 1 ? '' : 's'} ${inReview.length === 1 ? 'is' : 'are'} ready — approving keeps your publishing cadence on track.`
    : null;
  const flight = inPipeline.filter((p) => ['queued', 'researching', 'writing'].includes(p.status));
  const agentItems: { icon: string; title: string; detail: string; attn: boolean; action?: { label: string; href: string } }[] = [];
  if (inReview.length) agentItems.push({ icon: 'eye', title: `${inReview.length} draft${inReview.length === 1 ? '' : 's'} need review`, detail: 'Approve to let autopilot publish them', attn: true, action: { label: 'Review', href: '/dashboard/reviews' } });
  if (flight[0]) agentItems.push({ icon: 'search2', title: flight[0].status === 'writing' ? 'Drafting in your voice' : 'Researching live SERP', detail: `“${flight[0].title ?? flight[0].topic}”`, attn: false });
  if (flight[1]) agentItems.push({ icon: 'check', title: 'Next in the queue', detail: `“${flight[1].title ?? flight[1].topic}”`, attn: false });
  while (agentItems.length < 1) agentItems.push({ icon: 'check', title: 'All caught up', detail: 'No drafts in flight right now', attn: false });

  // ---- content pipeline table groups ----
  const toRow = (p: any): OvRow => {
    const s: OvRow['s'] = p.status === 'published' ? 'live' : p.status === 'review' ? 'review' : p.status === 'scheduled' ? 'publishing' : 'writing';
    const accentIcon = s === 'publishing' || s === 'live';
    const icon = s === 'live' ? 'published' : s === 'review' ? 'eye' : p.status === 'writing' ? 'pen' : 'doc';
    const reads = typeof p.reads === 'number' ? `${fmtNum(p.reads)} reads` : '';
    const meta = p.status === 'published' ? [reads].filter(Boolean).join(' · ') || 'live on your blog'
      : p.status === 'review' ? 'awaiting your approval'
      : p.status === 'scheduled' ? 'queued to publish'
      : (p.validation?.stats?.word_count ? 'draft in progress' : 'in the writer');
    return {
      id: p.id, icon, accentIcon, title: p.title ?? p.topic ?? '(untitled)', meta,
      keyword: p.topic ?? '—', words: p.validation?.stats?.word_count ? Number(p.validation.stats.word_count).toLocaleString() : '—',
      s, schedule: schedLabel(p),
    };
  };
  const groups: Record<string, OvRow[]> = {
    Pipeline: inPipeline.filter((p) => p.status !== 'review').slice(0, 6).map(toRow),
    'In review': inReview.slice(0, 6).map(toRow),
    Published: published.slice(0, 6).map(toRow),
  };

  // ---- channels (real cross-post state of the latest published post) ----
  const latestPub = published[0];
  const pubSocial = (latestPub?.social_published ?? {}) as Record<string, unknown>;
  const chState = (key: string) =>
    pubSocial[key] ? { state: 'Posted', color: ACCENT, dot: ACCENT }
      : domain?.auto_social ? { state: 'Queued', color: '#9aa096', dot: SAGE_DOT }
        : { state: 'Off', color: '#6b6f67', dot: '#565a53' };
  const channels = latestPub
    ? [
        { name: 'Blog post', dot: ACCENT, color: ACCENT, state: 'Published' },
        { name: 'X thread', ...chState('x') },
        { name: 'LinkedIn', ...chState('linkedin') },
        { name: 'Instagram', ...chState('instagram') },
      ]
    : [];

  // ---- top queries (real Search Console data; empty until GSC is connected) ----
  const topQueries = (gscVis?.topQueries ?? [])
    .slice(0, 5)
    .map((q) => ({ term: q.query, pos: Math.round(q.position), clicks: q.clicks }));

  // ---- recent activity (from real posts, newest first) ----
  const activityRows: { text: string; time: string; dot: string; ring: string }[] = [];
  for (const p of all.slice(0, 8)) {
    if (p.status === 'published' && p.published_at) {
      activityRows.push({ text: `Published “${(p.title ?? p.topic ?? '').slice(0, 38)}…”`, time: relTime(p.published_at), dot: ACCENT, ring: 'rgba(99,194,129,0.3)' });
    } else if (p.status === 'review') {
      activityRows.push({ text: `Draft ready for review · “${(p.title ?? p.topic ?? '').slice(0, 30)}”`, time: relTime(p.created_at), dot: '#e0c878', ring: 'rgba(224,200,120,0.3)' });
    } else if (['writing', 'researching', 'queued'].includes(p.status)) {
      activityRows.push({ text: `Started “${(p.title ?? p.topic ?? '').slice(0, 34)}”`, time: relTime(p.created_at), dot: '#7fb6e6', ring: 'rgba(127,182,230,0.3)' });
    }
    if (activityRows.length >= 5) break;
  }
  if (activityRows.length === 0) {
    activityRows.push({ text: 'Your agent is ready — queue a topic to begin', time: 'now', dot: SAGE_DOT, ring: 'rgba(142,165,150,0.3)' });
  }

  const shippedRecently = brief?.publishedThisWeek ?? published.length;

  return (
    <>
      <DashHeader title="Overview" subtitle={`${domain?.hostname ?? 'grove.ai'} · ${domain?.auto_publish ? 'autopilot active' : 'manual mode'}`} />

      <div className="gv-body" style={{ maxWidth: 1680, padding: '28px 36px 48px' }}>
        {/* search — relocated out of the nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240, maxWidth: 420, display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '9px 13px' }}>
            <span style={{ color: '#565a53', display: 'flex' }}><Icon name="search" size={16} /></span>
            <input placeholder="Search posts, keywords, domains…" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#eef1ea', fontSize: 13, fontFamily: 'inherit', minWidth: 0 }} />
            <span style={{ fontSize: 10.5, color: '#565a53', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, padding: '1px 6px' }}>⌘K</span>
          </div>
        </div>
        {/* greeting */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>{greeting()}</h1>
            <p style={{ fontSize: 14, color: '#9aa096', margin: '6px 0 0' }}>
              {shippedRecently > 0
                ? <>grove shipped <span style={{ color: '#eef1ea', fontWeight: 600 }}>{shippedRecently} post{shippedRecently === 1 ? '' : 's'}</span> this week.{inReview.length ? <> {inReview.length} {inReview.length === 1 ? 'draft is' : 'drafts are'} waiting on you.</> : ' Everything is on schedule.'}</>
                : <>Your agent is running. Queue a topic and the pipeline starts immediately.</>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 9 }}>
            <Link href="/dashboard/reviews" className="gv-ghost" style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, padding: '10px 16px', borderRadius: 10, cursor: 'pointer', textDecoration: 'none' }}>Review queue ({inReview.length})</Link>
            <Link href="/dashboard/write" className="gv-btn" style={{ border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: '10px 18px', borderRadius: 10, cursor: 'pointer', textDecoration: 'none' }}>Write</Link>
          </div>
        </div>

        {/* stat cards */}
        <div className="gv-grid4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          {stats.map((s, i) => (
            <div key={i} className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#9aa096', fontSize: 12.5 }}>
                <span style={{ display: 'flex', color: SAGE }}><Icon name={s.icon} /></span>{s.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 9, marginTop: 14 }}>
                <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, color: s.deltaColor, paddingBottom: 3 }}>{s.delta}</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#6b6f67', marginTop: 8 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* calendar + agent */}
        <div className="gv-2col-wide" style={{ display: 'grid', gridTemplateColumns: '1.85fr 1fr', gap: 14, marginBottom: 14 }}>
          {/* publishing calendar */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Publishing calendar</div>
                <div style={{ fontSize: 12.5, color: '#6b6f67', marginTop: 3 }}>When each post goes live, and where it is now</div>
              </div>
              <Link href="/dashboard/calendar" style={{ fontSize: 12.5, color: '#9aa096', textDecoration: 'none', fontWeight: 600 }}>Open calendar →</Link>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '16px 0 14px' }}>
              {calLegend.map((l) => (
                <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#9aa096' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: l.color }} />{l.label}
                </div>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600 }}>{calMonth}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
              {weekdays.map((w) => (
                <div key={w} style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#565a53', textAlign: 'center', paddingBottom: 2 }}>{w}</div>
              ))}
              {calDays.map((d, i) => (
                <div key={i} style={{ minHeight: 62, minWidth: 0, overflow: 'hidden', borderRadius: 9, background: d.bg, border: `1px solid ${d.border}`, padding: '6px 6px 5px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: d.numColor, alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>{d.num}</span>
                  {d.events.map((ev, j) => (
                    <span key={j} title={ev.full} style={{ display: 'block', fontSize: 9.5, fontWeight: 600, lineHeight: 1.25, color: ev.color, background: ev.chipBg, borderLeft: `2px solid ${ev.color}`, borderRadius: 4, padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.label}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* agent panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(99,194,129,0.12)', border: '1px solid rgba(99,194,129,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT }}><Icon name="leaf" /></span>
                  <div style={{ lineHeight: 1.2 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>Your marketing agent</div>
                    <div style={{ fontSize: 11, color: '#6b6f67' }}>autonomous · loop running</div>
                  </div>
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: SAGE, fontWeight: 600 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT, animation: 'gvPulse 1.8s ease-in-out infinite' }} />working
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#cdd2c9', lineHeight: 1.6, margin: '16px 0 16px' }}>{agentSummary}</div>

              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#565a53', marginBottom: 9 }}>Working on now</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {agentItems.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, background: a.attn ? 'rgba(224,200,120,0.06)' : 'rgba(255,255,255,0.025)', border: `1px solid ${a.attn ? 'rgba(224,200,120,0.22)' : 'rgba(255,255,255,0.06)'}` }}>
                    <span style={{ display: 'flex', color: a.attn ? '#e0c878' : SAGE, flexShrink: 0, marginTop: 1 }}><Icon name={a.icon} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#eef1ea' }}>{a.title}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: '#6b6f67', marginTop: 1, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.detail}</span>
                    </span>
                    {a.action && (
                      <Link href={a.action.href} className="gv-btn" style={{ border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.06)', color: '#eef1ea', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 11px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none' }}>{a.action.label}</Link>
                    )}
                  </div>
                ))}
              </div>

              {agentInsight && (
                <div style={{ marginTop: 18, padding: '14px 15px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: SAGE, marginBottom: 8 }}><span style={{ display: 'flex' }}><Icon name="answers" /></span> Agent insight</div>
                  <div style={{ fontSize: 12.5, color: '#dfe4da', lineHeight: 1.55 }}>{agentInsight}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <Link href="/dashboard/strategy" className="gv-btn" style={{ border: 'none', background: ACCENT, color: '#06120b', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 700, padding: '7px 13px', borderRadius: 8, cursor: 'pointer', textDecoration: 'none' }}>Review plan</Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* content pipeline table */}
        <OverviewPipeline groups={groups} />

        {/* bottom row */}
        <div className="gv-grid3" style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr 1fr', gap: 14 }}>
          {/* channels */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Cross-post queue</div>
            <div style={{ fontSize: 12, color: '#6b6f67', marginBottom: 18 }}>One brief, every channel</div>
            {channels.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#6b6f67', lineHeight: 1.6 }}>
                Once your first post publishes, its X / LinkedIn / Instagram variants show up here.{' '}
                <Link href="/dashboard/connections" style={{ color: '#9aa096', textDecoration: 'underline' }}>Connect channels →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {channels.map((c) => (
                  <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot }} />
                    <span style={{ fontSize: 13, color: '#cdd2c9' }}>{c.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: c.color }}>{c.state}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* top movers */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Top queries</div>
              <span style={{ fontSize: 11.5, color: '#6b6f67' }}>position · clicks</span>
            </div>
            {topQueries.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#6b6f67', lineHeight: 1.6 }}>
                The search queries you rank for appear here once Search Console is connected.{' '}
                <Link href="/dashboard/analytics" style={{ color: '#9aa096', textDecoration: 'underline' }}>Connect Search Console →</Link>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {topQueries.map((k) => (
                  <div key={k.term} className="gv-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 10px', borderRadius: 9, transition: 'background .15s' }}>
                    <span style={{ fontSize: 13, color: '#cdd2c9', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.term}</span>
                    <span style={{ fontSize: 12, color: '#6b6f67', fontVariantNumeric: 'tabular-nums' }}>#{k.pos}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: ACCENT, width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k.clicks}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* activity */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 18 }}>Recent activity</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {activityRows.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 13, paddingBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: a.dot, border: '2px solid #101310', boxShadow: `0 0 0 1px ${a.ring}` }} />
                    {i < activityRows.length - 1 && <span style={{ flex: 1, width: 1, background: 'rgba(255,255,255,0.07)', marginTop: 4 }} />}
                  </div>
                  <div style={{ marginTop: -3 }}>
                    <div style={{ fontSize: 12.5, color: '#cdd2c9', lineHeight: 1.45 }}>{a.text}</div>
                    <div style={{ fontSize: 11, color: '#565a53', marginTop: 3 }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
