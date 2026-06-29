'use client';
import { useState } from 'react';
import Icon from '../gv-icons';
import { HeaderRight } from '../gv-chrome';
import GoogleConnect from './GoogleConnect';
import type { AnalyticsData } from '@/lib/analytics/dashboard';

const ACCENT = '#63c281';

const fmtPct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

/* ── catmull-rom → bezier sparkline/area builder (ported from the comp) ───── */
function buildPaths(vals: number[], w: number, h: number, pad: number) {
  const n = vals.length, max = Math.max(...vals), min = Math.min(...vals), rng = (max - min) || 1;
  const pts = vals.map((v, i) => ({ x: pad + (i / (n - 1)) * (w - 2 * pad), y: pad + (1 - (v - min) / rng) * (h - 2 * pad) }));
  let d = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C ' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
  }
  const area = d + ' L ' + pts[n - 1].x.toFixed(1) + ' ' + (h - pad) + ' L ' + pts[0].x.toFixed(1) + ' ' + (h - pad) + ' Z';
  return { line: d, area, last: pts[n - 1] };
}

const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString();
};

type PeriodKey = '7d' | '30d' | '90d' | '12mo';

export default function AnalyticsDashboard({
  hostname, configured, connected, verified, data, syncedAgo,
}: {
  hostname: string;
  configured: boolean;
  connected: boolean;
  verified: boolean;
  data: AnalyticsData;
  syncedAgo: string;
}) {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [sort, setSort] = useState<'Clicks' | 'Impressions' | 'CTR'>('Clicks');
  const live = data.live;
  const liveOn = !!live;
  // Any real signal at all (GSC totals OR first-party events) flips the header
  // from "sample view" to "synced".
  const anyLive = liveOn || !!data.traffic || !!data.funnel || !!data.topContent;

  // ── real trend series, sliced to the selected period ────────────────────────
  // gsc_daily gives up to 90 days oldest→newest; 12mo just shows what we have.
  const periodDays: Record<PeriodKey, number> = { '7d': 7, '30d': 30, '90d': 90, '12mo': 365 };
  const sliced = (data.series ?? []).slice(-periodDays[period]);
  const liveSeries = sliced.length >= 2
    ? {
        clicks: sliced.map((p) => p.clicks),
        impr: sliced.map((p) => p.impressions),
        labels: sliced.map((p, i, a) => (i === 0 || i === a.length - 1 || i === Math.floor(a.length / 2) ? p.date.slice(5) : '')),
      }
    : null;

  // ── period ────────────────────────────────────────────────────────────────
  const periodDef = [
    { key: '7d' as const, label: '7d', range: 'past 7 days', short: '7 days', cites: '38' },
    { key: '30d' as const, label: '30d', range: 'past 30 days', short: '30 days', cites: '401' },
    { key: '90d' as const, label: '90d', range: 'past quarter', short: '90 days', cites: '1,140' },
    { key: '12mo' as const, label: '12mo', range: 'past year', short: '12 months', cites: '4,820' },
  ];
  const curP = periodDef.find((p) => p.key === period) || periodDef[1];

  // ── main chart series (sample shapes; headline scalars overridden when live) ─
  const series: Record<PeriodKey, { clicks: number[]; impr: number[]; labels: string[]; c: string; cd: string; im: string; ctr: string }> = {
    '7d': { clicks: [30, 34, 33, 39, 44, 42, 50], impr: [55, 58, 57, 62, 67, 66, 72], labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], c: '9,840', cd: '▲ 22%', im: '241k', ctr: '4.1%' },
    '30d': { clicks: [18, 21, 20, 26, 30, 29, 34, 38, 37, 44, 48, 52], impr: [40, 44, 42, 49, 53, 52, 58, 63, 62, 69, 74, 80], labels: ['', 'Wk 1', '', 'Wk 2', '', 'Wk 3', '', 'Wk 4', ''], c: '48,210', cd: '▲ 38%', im: '1.2M', ctr: '4.0%' },
    '90d': { clicks: [8, 10, 12, 14, 13, 18, 22, 26, 30, 34, 40, 46, 52, 60, 68], impr: [25, 28, 32, 36, 38, 44, 50, 56, 60, 66, 72, 78, 84, 90, 96], labels: ['Apr', '', '', 'May', '', '', 'Jun', ''], c: '128k', cd: '▲ 312%', im: '3.4M', ctr: '3.8%' },
    '12mo': { clicks: [4, 6, 9, 12, 16, 20, 27, 34, 42, 51, 60, 72], impr: [15, 20, 26, 33, 40, 48, 57, 66, 74, 82, 90, 98], labels: ['Jul', '', 'Sep', '', 'Nov', '', 'Jan', '', 'Mar', '', 'May', ''], c: '486k', cd: '▲ 1,180%', im: '12.4M', ctr: '3.9%' },
  };
  const cur = series[period];
  const chartClicks = liveSeries ? liveSeries.clicks : cur.clicks;
  const chartImpr = liveSeries ? liveSeries.impr : cur.impr.map((v, i) => Math.max(v, cur.clicks[i] + 6));
  const chartLabels = liveSeries ? liveSeries.labels : cur.labels;
  const cP = buildPaths(chartClicks, 640, 220, 14);
  const iP = buildPaths(chartImpr, 640, 220, 14);

  // Real period-over-period clicks delta from the daily series (prior equal
  // window). null when there isn't enough history yet → no chip shown.
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  let liveDelta: string | null = null;
  if (data.series && data.series.length) {
    const d = periodDays[period];
    const curWin = data.series.slice(-d), prevWin = data.series.slice(-2 * d, -d);
    const cs = sum(curWin.map((p) => p.clicks)), ps = sum(prevWin.map((p) => p.clicks));
    if (ps > 0) { const pct = Math.round(((cs - ps) / ps) * 100); liveDelta = `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`; }
  }
  const clicksDelta = liveSeries ? (liveDelta ?? '') : cur.cd;

  const kpiClicks = liveOn ? fmtCompact(live!.clicks) : cur.c;
  const kpiImpr = liveOn ? fmtCompact(live!.impressions) : cur.im;
  const kpiCtr = liveOn ? `${(live!.ctr * 100).toFixed(1)}%` : cur.ctr;
  const headlineClicks = liveOn ? fmtCompact(live!.clicks) : cur.c;

  // ── KPI cards ───────────────────────────────────────────────────────────────
  const kpiDef = [
    { icon: 'rankings', label: 'Organic clicks', value: liveOn ? fmtCompact(live!.clicks) : '48.2k', delta: '▲ 312%', up: true, spark: [12, 15, 14, 19, 22, 21, 27, 31, 30, 38, 44, 52], fill: true },
    { icon: 'eye', label: 'Impressions', value: liveOn ? fmtCompact(live!.impressions) : '1.2M', delta: '▲ 38%', up: true, spark: [40, 44, 42, 49, 53, 52, 58, 63, 62, 69, 74, 80], fill: false },
    { icon: 'cursor', label: 'Avg. CTR', value: liveOn ? `${(live!.ctr * 100).toFixed(1)}%` : '4.0%', delta: '▲ 0.6pt', up: true, spark: [28, 30, 29, 33, 31, 35, 34, 38, 37, 40, 39, 42], fill: false },
    { icon: 'target', label: 'Avg. position', value: liveOn ? (live!.avgPosition ? live!.avgPosition.toFixed(1) : '—') : '4.2', delta: '▲ from 18', up: true, spark: [62, 58, 55, 49, 44, 40, 33, 28, 22, 17, 12, 9], fill: false },
    { icon: 'spark', label: data.answers ? 'AI referrals' : 'AI citations', value: data.answers ? fmtCompact(data.answers.total) : '401', delta: data.answers ? '' : '▲ 41%', up: true, spark: [8, 10, 12, 16, 15, 22, 28, 30, 36, 42, 48, 57], fill: true },
  ];

  // ── traffic sources (conic donut) ──────────────────────────────────────────
  const SOURCE_COLORS = [ACCENT, '#7fb6e6', '#9aa096', '#565a53'];
  const sourceDef = data.traffic
    ? data.traffic.sources.map((s, i) => ({ name: s.name, pct: s.pct, color: SOURCE_COLORS[i] ?? '#565a53' }))
    : [
        { name: 'Google Search', pct: 58, color: ACCENT },
        { name: 'Answer engines', pct: 24, color: '#7fb6e6' },
        { name: 'Direct', pct: 11, color: '#9aa096' },
        { name: 'Social + referral', pct: 7, color: '#565a53' },
      ];
  const answerSharePct = data.traffic ? (data.traffic.sources.find((s) => s.key === 'answer')?.pct ?? 0) : 24;
  let acc = 0;
  const donutGradient = 'conic-gradient(' + sourceDef.map((s) => { const start = acc; acc += s.pct; return `${s.color} ${start}% ${acc}%`; }).join(', ') + ')';

  // ── top posts ───────────────────────────────────────────────────────────────
  type PostRow = { title: string; keyword: string; clicks: string; impr: string; ctr: string; pos: string; posChange: string; up: boolean; spark: number[] | null };
  const samplePosts: PostRow[] = [
    { title: 'The SaaS founder’s guide to compounding traffic', keyword: 'compounding organic traffic', clicks: '9,120', impr: '184k', ctr: '4.9%', pos: '3', posChange: '▲12', up: true, spark: [10, 14, 18, 22, 30, 38, 46, 52] },
    { title: 'How to write for answer engines', keyword: 'write for answer engines', clicks: '6,740', impr: '142k', ctr: '4.7%', pos: '2', posChange: '▲8', up: true, spark: [6, 9, 12, 18, 24, 30, 40, 48] },
    { title: '10 onboarding mistakes killing activation', keyword: 'ai onboarding checklist', clicks: '5,310', impr: '121k', ctr: '4.4%', pos: '3', posChange: '▲15', up: true, spark: [4, 6, 10, 14, 22, 30, 38, 44] },
    { title: 'Programmatic SEO without a dev team', keyword: 'programmatic seo no code', clicks: '4,180', impr: '108k', ctr: '3.9%', pos: '5', posChange: '▲6', up: true, spark: [8, 10, 9, 14, 18, 22, 28, 34] },
    { title: 'How we cut SaaS churn 18% in a quarter', keyword: 'reduce saas churn', clicks: '3,640', impr: '96k', ctr: '3.8%', pos: '6', posChange: '▲4', up: true, spark: [12, 14, 13, 16, 18, 20, 24, 28] },
    { title: 'The honest cost of an in-house content team', keyword: 'content team cost', clicks: '2,210', impr: '88k', ctr: '2.5%', pos: '14', posChange: '▼2', up: false, spark: [20, 18, 19, 16, 15, 14, 13, 12] },
  ];
  const sortKey = sort === 'Impressions' ? 'impressions' : sort === 'CTR' ? 'ctr' : 'clicks';
  const postDef: PostRow[] = data.topContent
    ? [...data.topContent]
        .sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey])
        .map((c) => ({
          title: c.title,
          keyword: c.path,
          clicks: c.clicks.toLocaleString(),
          impr: fmtCompact(c.impressions),
          ctr: fmtPct(c.ctr),
          pos: c.position ? `${c.position.toFixed(1)}` : '—',
          posChange: '',
          up: true,
          spark: null,
        }))
    : samplePosts;

  // ── rank distribution ───────────────────────────────────────────────────────
  const RANK_COLORS = [ACCENT, 'rgba(99,194,129,0.55)', '#7f8a86', '#3a4640'];
  const rankDef = data.ranking
    ? data.ranking.bands.map((b, i) => ({ label: b.label, count: b.count, color: RANK_COLORS[i] ?? '#3a4640' }))
    : [
        { label: 'Positions 1–3', count: 42, color: ACCENT },
        { label: 'Positions 4–10', count: 76, color: 'rgba(99,194,129,0.55)' },
        { label: 'Positions 11–20', count: 58, color: '#7f8a86' },
        { label: 'Positions 21+', count: 38, color: '#3a4640' },
      ];
  const rankTotal = rankDef.reduce((a, b) => a + b.count, 0);
  const rankBands = rankDef.map((b) => ({ ...b, pct: Math.round((b.count / rankTotal) * 100) + '%' }));

  const engines = data.answers
    ? data.answers.byEngine.map((e) => ({ name: e.name, count: String(e.count), pct: `${e.pct}%` }))
    : [
        { name: 'ChatGPT', count: '186', pct: '88%' },
        { name: 'Google AI Overviews', count: '142', pct: '67%' },
        { name: 'Perplexity', count: '73', pct: '34%' },
      ];

  const funnelDef = data.funnel
    ? (() => {
        const f = data.funnel!;
        const rate = (n: number) => (f.clicks > 0 ? `${Math.round((n / f.clicks) * 100)}%` : '0%');
        return [
          { label: 'Clicks to blog', value: fmtCompact(f.clicks), rate: '100%', pct: '100%', bar: ACCENT },
          { label: 'Read past 50%', value: fmtCompact(f.read50), rate: rate(f.read50), pct: rate(f.read50), bar: 'rgba(99,194,129,0.7)' },
          { label: 'Converted (CTA)', value: fmtCompact(f.converted), rate: rate(f.converted), pct: rate(f.converted), bar: 'rgba(99,194,129,0.5)' },
        ];
      })()
    : [
        { label: 'Clicks to blog', value: '48.2k', rate: '100%', pct: '100%', bar: ACCENT },
        { label: 'Read past 50%', value: '21.7k', rate: '45%', pct: '45%', bar: 'rgba(99,194,129,0.7)' },
        { label: 'Email captured', value: '3,180', rate: '6.6%', pct: '28%', bar: 'rgba(99,194,129,0.5)' },
        { label: 'Started trial', value: '742', rate: '1.5%', pct: '14%', bar: 'rgba(99,194,129,0.35)' },
      ];

  return (
    <>
      {/* ============ TOP BAR ============ */}
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Analytics</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>{hostname} · how the blog is compounding</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, gap: 3 }}>
            {periodDef.map((p) => {
              const on = period === p.key;
              return (
                <button key={p.key} onClick={() => setPeriod(p.key)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999, transition: '.2s', background: on ? ACCENT : 'transparent', color: on ? '#06120b' : '#9aa096' }}>{p.label}</button>
              );
            })}
          </div>
          <GoogleConnect configured={configured} connected={connected} verified={verified} />
          <button className="gv-ghost" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: '#cdd2c9', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}>
            <Icon name="download" /> Export
          </button>
          <span style={{ width: 1, height: 26, background: 'rgba(255,255,255,0.08)' }} />
          <HeaderRight />
        </div>
      </header>

      {/* ============ BODY ============ */}
      <div style={{ position: 'relative', padding: '28px 36px 48px', maxWidth: 1680, margin: '0 auto' }}>

        {/* summary line */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>Performance report</h1>
            <p style={{ fontSize: 14, color: '#9aa096', margin: '6px 0 0' }}>Over the {curP.range}, your content earned <span style={{ color: '#eef1ea', fontWeight: 600 }}>{headlineClicks} clicks</span>
              {data.answers
                ? <> and <span style={{ color: '#eef1ea', fontWeight: 600 }}>{data.answers.total.toLocaleString()} answer-engine referrals</span>.</>
                : <> and was quoted <span style={{ color: '#eef1ea', fontWeight: 600 }}>{curP.cites} times</span> by answer engines.</>}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b6f67' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT, animation: 'gvPulse 2.4s ease-in-out infinite' }} />
            {anyLive
              ? <>Synced from Search Console &amp; first-party events · {syncedAgo}</>
              : <>Sample view — connect Google to see your numbers</>}
          </div>
        </div>

        {/* KPI ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 14 }}>
          {kpiDef.map((k) => {
            const sp = buildPaths(k.spark, 120, 34, 4);
            return (
              <div key={k.label} className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '18px 18px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#9aa096', fontSize: 12 }}>
                  <span style={{ display: 'flex', color: ACCENT }}><Icon name={k.icon} /></span>{k.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
                  <span style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{k.value}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color: k.up ? ACCENT : '#c97f7f', paddingBottom: 2 }}>{k.delta}</span>
                </div>
                <svg viewBox="0 0 120 34" preserveAspectRatio="none" style={{ width: '100%', height: 30, marginTop: 12, overflow: 'visible' }}>
                  <path d={sp.area} fill={k.fill ? 'rgba(99,194,129,0.14)' : 'transparent'} stroke="none" />
                  <path d={sp.line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            );
          })}
        </div>

        {/* MAIN CHART + TRAFFIC SOURCES */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.85fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* chart */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Organic performance</div>
                <div style={{ fontSize: 12.5, color: '#6b6f67', marginTop: 3 }}>Clicks &amp; impressions from Google + answer engines</div>
              </div>
              <div style={{ display: 'flex', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#9aa096' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: ACCENT }} />Clicks</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#9aa096' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.22)' }} />Impressions</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 28, margin: '18px 0 6px' }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{kpiClicks}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#9aa096', marginTop: 3 }}>Clicks <span style={{ color: ACCENT, fontWeight: 600 }}>{clicksDelta}</span></div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#cdd2c9' }}>{kpiImpr}</div>
                <div style={{ fontSize: 12, color: '#9aa096', marginTop: 3 }}>Impressions</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: '#cdd2c9' }}>{kpiCtr}</div>
                <div style={{ fontSize: 12, color: '#9aa096', marginTop: 3 }}>Avg. CTR</div>
              </div>
            </div>

            <svg viewBox="0 0 640 220" preserveAspectRatio="none" style={{ width: '100%', height: 210, marginTop: 6, overflow: 'visible' }}>
              <defs>
                <linearGradient id="gvAreaA" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.34} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <line x1="0" y1="40" x2="640" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <line x1="0" y1="100" x2="640" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <line x1="0" y1="160" x2="640" y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
              <path d={iP.line} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={2} strokeDasharray="4 5" strokeLinecap="round" />
              <path d={cP.area} fill="url(#gvAreaA)" stroke="none" />
              <path d={cP.line} fill="none" stroke={ACCENT} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={cP.last.x.toFixed(1)} cy={cP.last.y.toFixed(1)} r={4.5} fill={ACCENT} stroke="#0a0b0a" strokeWidth={2.5} />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#565a53', marginTop: 10 }}>
              {chartLabels.map((lab, i) => <span key={i}>{lab}</span>)}
            </div>
          </div>

          {/* traffic sources */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Traffic sources</div>
            <div style={{ fontSize: 12, color: '#6b6f67', margin: '3px 0 16px' }}>Where the clicks came from</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0, borderRadius: '50%', background: donutGradient }}>
                <div style={{ position: 'absolute', inset: 19, borderRadius: '50%', background: '#101310', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{data.traffic ? fmtCompact(data.traffic.total) : (liveOn ? fmtCompact(live!.clicks) : cur.c)}</span>
                  <span style={{ fontSize: 10, color: '#6b6f67', marginTop: 3 }}>{data.traffic ? 'total visits' : 'total clicks'}</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sourceDef.map((s) => (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, color: '#cdd2c9', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ paddingTop: 18, fontSize: 11.5, color: '#6b6f67', lineHeight: 1.55, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 20 }}>
              <span style={{ color: ACCENT, fontWeight: 600 }}>Answer engines</span> {data.traffic ? <>drive {answerSharePct}% of clicks to your blog.</> : <>now drive 24% of all clicks — up from 4% a quarter ago.</>}
            </div>
          </div>
        </div>

        {/* TOP CONTENT TABLE */}
        <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Top performing content</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['Clicks', 'Impressions', 'CTR'] as const).map((t) => {
                  const on = sort === t;
                  return (
                    <button key={t} onClick={() => setSort(t)} style={{ border: `1px solid ${on ? 'rgba(99,194,129,0.25)' : 'rgba(255,255,255,0.08)'}`, background: on ? 'rgba(99,194,129,0.12)' : 'transparent', color: on ? '#eef1ea' : '#9aa096', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}>{t}</button>
                  );
                })}
              </div>
            </div>
            <a href="#" style={{ fontSize: 12.5, color: '#9aa096', textDecoration: 'none' }}>{data.topContent ? 'Top pages' : 'View all 128 →'}</a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 120px 80px 90px 110px', padding: '11px 22px', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#565a53', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span>Post</span><span style={{ textAlign: 'right' }}>Clicks</span><span style={{ textAlign: 'right' }}>Impressions</span><span style={{ textAlign: 'right' }}>CTR</span><span style={{ textAlign: 'right' }}>Avg. pos</span><span style={{ textAlign: 'right' }}>30-day trend</span>
          </div>
          {postDef.map((p) => {
            const sp = p.spark ? buildPaths(p.spark, 96, 28, 3) : null;
            return (
              <div key={p.title} className="gv-row" style={{ display: 'grid', gridTemplateColumns: '1fr 110px 120px 80px 90px 110px', alignItems: 'center', padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 18 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,194,129,0.1)', border: '1px solid rgba(99,194,129,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT, flexShrink: 0 }}><Icon name="doc" /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#6b6f67' }}>{p.keyword}</span>
                  </span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.clicks}</span>
                <span style={{ fontSize: 12.5, color: '#9aa096', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.impr}</span>
                <span style={{ fontSize: 12.5, color: '#cdd2c9', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.ctr}</span>
                <span style={{ textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#cdd2c9', fontVariantNumeric: 'tabular-nums' }}>#{p.pos}<span style={{ fontSize: 11, fontWeight: 600, color: p.up ? ACCENT : '#c97f7f' }}>{p.posChange}</span></span></span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  {sp
                    ? <svg viewBox="0 0 96 28" preserveAspectRatio="none" style={{ width: 92, height: 26, overflow: 'visible' }}>
                        <path d={sp.line} fill="none" stroke={p.up ? ACCENT : '#c97f7f'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    : <span style={{ fontSize: 11, color: '#565a53' }}>—</span>}
                </span>
              </div>
            );
          })}
        </div>

        {/* BOTTOM ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

          {/* rank distribution */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Ranking distribution</div>
              <span style={{ fontSize: 11.5, color: ACCENT, fontWeight: 600 }}>{rankTotal} terms</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b6f67', marginBottom: 18 }}>Keyword positions on Google</div>
            <div style={{ display: 'flex', height: 12, borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
              {rankBands.map((b) => <span key={b.label} style={{ width: b.pct, background: b.color }} />)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {rankBands.map((b) => (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, color: '#cdd2c9', flex: 1 }}>{b.label}</span>
                  <span style={{ fontSize: 12.5, color: '#6b6f67', fontVariantNumeric: 'tabular-nums' }}>{b.pct}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* answer engine citations */}
          <div className="gv-card" style={{ background: 'linear-gradient(150deg, #0c130e, #0a0d0a)', border: '1px solid rgba(99,194,129,0.16)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{data.answers ? 'Answer-engine referrals' : 'Answer-engine citations'}</div>
              {!data.answers && <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600 }}>▲ 41%</span>}
            </div>
            <div style={{ fontSize: 12, color: '#6b6f67', margin: '3px 0 18px' }}>{data.answers ? 'Visits that came from an answer engine' : 'Times grove content was quoted'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              {engines.map((e) => (
                <div key={e.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 7 }}><span style={{ color: '#cdd2c9' }}>{e.name}</span><span style={{ fontWeight: 700 }}>{e.count}</span></div>
                  <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', width: e.pct, borderRadius: 99, background: `linear-gradient(90deg, rgba(99,194,129,0.5), ${ACCENT})` }} /></div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: '#6b6f67', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 18 }}>{data.answers ? 'Click-throughs only — Google AI Overviews report as regular Search.' : '75% of published posts are structured for AI Overviews.'}</div>
          </div>

          {/* conversion funnel */}
          <div className="gv-card" style={{ background: '#101310', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Content funnel</div>
              <span style={{ fontSize: 11.5, color: '#6b6f67' }}>{curP.short}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b6f67', marginBottom: 18 }}>From a click to a signup</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {funnelDef.map((f) => (
                <div key={f.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 12.5, color: '#cdd2c9' }}>{f.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f.value} <span style={{ fontSize: 11, fontWeight: 500, color: '#6b6f67' }}>{f.rate}</span></span>
                  </div>
                  <div style={{ height: 26, borderRadius: 8, background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}><div style={{ height: '100%', width: f.pct, borderRadius: 8, background: f.bar }} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
