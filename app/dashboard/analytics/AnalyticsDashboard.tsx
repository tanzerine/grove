'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '../gv-icons';
import { DashHeader } from '../gv-chrome';
import GoogleConnect from './GoogleConnect';
import AskAgent from '../AskAgent';
import type { AnalyticsData } from '@/lib/analytics/dashboard';
import { formatDuration } from '@/lib/ga4/insights';
import { useT } from '../i18n';
import { msg } from '@/lib/i18n';

const ACCENT = 'var(--gv-accent)';
const ACCENT_INK = 'var(--gv-accent-ink)';

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
  return { line: d, area, last: pts[n - 1], pts };
}

const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString();
};

/* Publish dates render in the viewer's timezone, en-US, like LocalTime — the
   server renders them in UTC, so the <time> that carries this needs
   suppressHydrationWarning. The year is dropped for the current year: on the
   common case (a blog publishing now) it's noise in a narrow column. */
const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
};

type PeriodKey = '7d' | '30d' | '90d' | '12mo';

export default function AnalyticsDashboard({
  hostname, configured, connected, verified, data, syncedAgo, period,
}: {
  hostname: string;
  configured: boolean;
  connected: boolean;
  verified: boolean;
  data: AnalyticsData;
  syncedAgo: string;
  period: PeriodKey;
}) {
  const t = useT();
  // Registered for the translation extractor; see the sort-chip comment below.
  void [msg('Views'), msg('Clicks'), msg('Impressions'), msg('CTR')];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The period selector writes ?range= and the server refetches GA + first-party
  // events for that window — the old client-only state left every live number
  // frozen while only the sample chart moved.
  const setPeriod = (p: PeriodKey) =>
    startTransition(() => router.push(`/dashboard/analytics?range=${p}`, { scroll: false }));
  // Live accounts default to sorting by Views (the article metric this table
  // exists to surface); the sample view has no views column, so keep Clicks.
  const [sort, setSort] = useState<'Clicks' | 'Impressions' | 'CTR' | 'Views'>(data.articles ? 'Views' : 'Clicks');
  const [chartHover, setChartHover] = useState<number | null>(null);
  const live = data.live;
  const liveOn = !!live;
  const ga = data.ga;           // whole-site Google Analytics (landing + blog + articles)
  const eng = data.engagement;  // first-party dwell + event count (blog articles)
  // Any real signal at all (GSC totals OR first-party events) flips the header
  // from "sample view" to "synced".
  const anyLive = liveOn || !!data.traffic || !!data.funnel || !!data.articles;

  // ILLUSTRATIVE NUMBERS ARE OPT-IN, AND OFF ON EVERY LOAD.
  //
  // They used to be the default fallback for every empty section, so a brand-new
  // account opened "Performance report" to 48.2k clicks, ▲312%, and six invented
  // article titles — presented in the headline as *their* content's performance.
  // The `sample` chip meant to label those cards was itself gated on `anyLive`,
  // so the one account that most needed the warning (a fresh one, nothing live)
  // was the only account that never saw it.
  //
  // The illustrative view earns its keep in demos, so it survives — but a
  // customer's own report must contain only their own data unless they
  // deliberately ask otherwise, and every card the sample fills is chipped.
  const [sampleOn, setSampleOn] = useState(false);

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
  // No Search Console history and no sample requested → the chart draws nothing
  // rather than an invented growth curve.
  const chartEmpty = !liveSeries && !sampleOn;
  const chartClicks = liveSeries ? liveSeries.clicks : cur.clicks;
  const chartImpr = liveSeries ? liveSeries.impr : cur.impr.map((v, i) => Math.max(v, cur.clicks[i] + 6));
  const chartLabels = liveSeries ? liveSeries.labels : cur.labels;
  // Full per-point date when live (sliced carries real dates); sample data only
  // has the sparse axis labels, so hover falls back to a generic point index.
  const chartDates = liveSeries ? sliced.map((p) => p.date) : null;
  const cP = buildPaths(chartClicks, 640, 220, 14);
  const iP = buildPaths(chartImpr, 640, 220, 14);

  // Real period-over-period deltas from the daily series: current window vs
  // the prior equal window. null when there isn't enough history yet → no chip.
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const avg = (a: number[]) => (a.length ? sum(a) / a.length : 0);
  type SeriesKey = 'clicks' | 'impressions' | 'ctr' | 'position';
  const winPair = (key: SeriesKey): [number[], number[]] => {
    const d = periodDays[period];
    const s = data.series ?? [];
    return [s.slice(-d).map((p) => p[key]), s.slice(-2 * d, -d).map((p) => p[key])];
  };
  // clicks / impressions: % change of window totals
  const pctDelta = (key: SeriesKey): { text: string; up: boolean } | null => {
    const [curW, prevW] = winPair(key);
    const cs = sum(curW), ps = sum(prevW);
    if (!prevW.length || ps <= 0) return null;
    const pct = Math.round(((cs - ps) / ps) * 100);
    return { text: `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}%`, up: pct >= 0 };
  };
  // CTR: point change of window averages
  const ctrDelta = (): { text: string; up: boolean } | null => {
    const [curW, prevW] = winPair('ctr');
    if (!prevW.length) return null;
    const pt = (avg(curW) - avg(prevW)) * 100;
    if (Math.abs(pt) < 0.05) return null;
    return { text: `${pt >= 0 ? '▲' : '▼'} ${Math.abs(pt).toFixed(1)}pt`, up: pt >= 0 };
  };
  // position: lower is better — an improvement shows as ▲
  const posDelta = (): { text: string; up: boolean } | null => {
    const [curW, prevW] = winPair('position');
    const c = avg(curW.filter((v) => v > 0)), p = avg(prevW.filter((v) => v > 0));
    if (!c || !p) return null;
    const diff = p - c;
    if (Math.abs(diff) < 0.05) return null;
    return { text: `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}`, up: diff >= 0 };
  };
  const clicksLiveDelta = pctDelta('clicks');
  // live account without enough daily history: show no delta rather than a fake one
  const clicksDelta = liveSeries ? (clicksLiveDelta?.text ?? '') : liveOn || !sampleOn ? '' : cur.cd;

  const kpiClicks = liveOn ? fmtCompact(live!.clicks) : sampleOn ? cur.c : '—';
  const kpiImpr = liveOn ? fmtCompact(live!.impressions) : sampleOn ? cur.im : '—';
  const kpiCtr = liveOn ? `${(live!.ctr * 100).toFixed(1)}%` : sampleOn ? cur.ctr : '—';

  // ── KPI cards — live accounts get real sparklines + real deltas; the sample
  // view (labeled as such in the header) keeps illustrative shapes ────────────
  type Kpi = { icon: string; label: string; value: string; delta: string; up: boolean; spark: number[] | null; fill: boolean };
  const liveSpark = (key: SeriesKey): number[] | null =>
    sliced.length >= 2 ? sliced.map((p) => p[key]) : null;
  const kpiDef: Kpi[] = liveOn
    ? [
        { icon: 'rankings', label: t('Organic clicks'), value: fmtCompact(live!.clicks), delta: clicksLiveDelta?.text ?? '', up: clicksLiveDelta?.up ?? true, spark: liveSpark('clicks'), fill: true },
        { icon: 'eye', label: t('Impressions'), value: fmtCompact(live!.impressions), delta: pctDelta('impressions')?.text ?? '', up: pctDelta('impressions')?.up ?? true, spark: liveSpark('impressions'), fill: false },
        { icon: 'cursor', label: t('Avg. CTR'), value: `${(live!.ctr * 100).toFixed(1)}%`, delta: ctrDelta()?.text ?? '', up: ctrDelta()?.up ?? true, spark: liveSpark('ctr'), fill: false },
        { icon: 'target', label: t('Avg. position'), value: live!.avgPosition ? live!.avgPosition.toFixed(1) : '—', delta: posDelta()?.text ?? '', up: posDelta()?.up ?? true, spark: liveSpark('position'), fill: false },
        { icon: 'spark', label: data.answers ? t('AI referrals') : t('AI citations'), value: data.answers ? fmtCompact(data.answers.total) : '—', delta: '', up: true, spark: null, fill: true },
      ]
    : sampleOn
    ? [
        { icon: 'rankings', label: t('Organic clicks'), value: '48.2k', delta: '▲ 312%', up: true, spark: [12, 15, 14, 19, 22, 21, 27, 31, 30, 38, 44, 52], fill: true },
        { icon: 'eye', label: t('Impressions'), value: '1.2M', delta: '▲ 38%', up: true, spark: [40, 44, 42, 49, 53, 52, 58, 63, 62, 69, 74, 80], fill: false },
        { icon: 'cursor', label: t('Avg. CTR'), value: '4.0%', delta: '▲ 0.6pt', up: true, spark: [28, 30, 29, 33, 31, 35, 34, 38, 37, 40, 39, 42], fill: false },
        { icon: 'target', label: t('Avg. position'), value: '4.2', delta: '▲ from 18', up: true, spark: [62, 58, 55, 49, 44, 40, 33, 28, 22, 17, 12, 9], fill: false },
        { icon: 'spark', label: data.answers ? t('AI referrals') : t('AI citations'), value: data.answers ? fmtCompact(data.answers.total) : '401', delta: data.answers ? '' : '▲ 41%', up: true, spark: [8, 10, 12, 16, 15, 22, 28, 30, 36, 42, 48, 57], fill: true },
      ]
    // Nothing measured yet: the cards keep their shape (so the page doesn't
    // reflow the moment data lands) but state plainly that there's no number.
    : [
        { icon: 'rankings', label: t('Organic clicks'), value: '—', delta: '', up: true, spark: null, fill: true },
        { icon: 'eye', label: t('Impressions'), value: '—', delta: '', up: true, spark: null, fill: false },
        { icon: 'cursor', label: t('Avg. CTR'), value: '—', delta: '', up: true, spark: null, fill: false },
        { icon: 'target', label: t('Avg. position'), value: '—', delta: '', up: true, spark: null, fill: false },
        { icon: 'spark', label: data.answers ? t('AI referrals') : t('AI citations'), value: data.answers ? fmtCompact(data.answers.total) : '—', delta: '', up: true, spark: null, fill: true },
      ];

  // ── traffic sources (conic donut) ──────────────────────────────────────────
  const SOURCE_COLORS = [ACCENT, 'var(--gv-sky)', 'var(--gv-dim)', 'var(--gv-fainter)'];
  const sourceDef = data.traffic
    ? data.traffic.sources.map((s, i) => ({ name: s.name, pct: s.pct, color: SOURCE_COLORS[i] ?? 'var(--gv-fainter)' }))
    : sampleOn
    ? [
        { name: 'Google Search', pct: 58, color: ACCENT_INK },
        { name: t('Answer engines'), pct: 24, color: 'var(--gv-sky)' },
        { name: 'Direct', pct: 11, color: 'var(--gv-dim)' },
        { name: 'Social + referral', pct: 7, color: 'var(--gv-fainter)' },
      ]
    : [];
  const answerSharePct = data.traffic ? (data.traffic.sources.find((s) => s.key === 'answer')?.pct ?? 0) : 24;
  let acc = 0;
  // An empty source list would emit `conic-gradient()` — invalid CSS, which
  // paints nothing at all. Fall back to a flat inert ring.
  const donutGradient = sourceDef.length
    ? 'conic-gradient(' + sourceDef.map((s) => { const start = acc; acc += s.pct; return `${s.color} ${start}% ${acc}%`; }).join(', ') + ')'
    : 'rgba(255,255,255,0.05)';

  // ── articles table ──────────────────────────────────────────────────────────
  // Live accounts see EVERY published article (GSC clicks/impressions merged
  // across the article's URLs + first-party tracked views), not "top pages" —
  // on a young blog top-pages is the homepage and /pricing, never the articles.
  type PostRow = { title: string; keyword: string; published?: string | null; views?: string; clicks: string; impr: string; ctr: string; pos: string; posChange: string; up: boolean; spark: number[] | null };
  const samplePosts: PostRow[] = [
    { title: 'The SaaS founder’s guide to compounding traffic', keyword: 'compounding organic traffic', clicks: '9,120', impr: '184k', ctr: '4.9%', pos: '3', posChange: '▲12', up: true, spark: [10, 14, 18, 22, 30, 38, 46, 52] },
    { title: 'How to write for answer engines', keyword: 'write for answer engines', clicks: '6,740', impr: '142k', ctr: '4.7%', pos: '2', posChange: '▲8', up: true, spark: [6, 9, 12, 18, 24, 30, 40, 48] },
    { title: '10 onboarding mistakes killing activation', keyword: 'ai onboarding checklist', clicks: '5,310', impr: '121k', ctr: '4.4%', pos: '3', posChange: '▲15', up: true, spark: [4, 6, 10, 14, 22, 30, 38, 44] },
    { title: 'Programmatic SEO without a dev team', keyword: 'programmatic seo no code', clicks: '4,180', impr: '108k', ctr: '3.9%', pos: '5', posChange: '▲6', up: true, spark: [8, 10, 9, 14, 18, 22, 28, 34] },
    { title: 'How we cut SaaS churn 18% in a quarter', keyword: 'reduce saas churn', clicks: '3,640', impr: '96k', ctr: '3.8%', pos: '6', posChange: '▲4', up: true, spark: [12, 14, 13, 16, 18, 20, 24, 28] },
    { title: 'The honest cost of an in-house content team', keyword: 'content team cost', clicks: '2,210', impr: '88k', ctr: '2.5%', pos: '14', posChange: '▼2', up: false, spark: [20, 18, 19, 16, 15, 14, 13, 12] },
  ];
  const articlesLive = !!data.articles;
  const sortKey = sort === t('Impressions') ? 'impressions' : sort === t('CTR') ? 'ctr' : sort === t('Views') ? 'views' : 'clicks';
  const postDef: PostRow[] = data.articles
    ? [...data.articles]
        .sort((a, b) => (b as any)[sortKey] - (a as any)[sortKey])
        .map((c) => ({
          title: c.title,
          keyword: c.path,
          published: c.publishedAt,
          views: c.views.toLocaleString(),
          clicks: c.clicks.toLocaleString(),
          impr: fmtCompact(c.impressions),
          ctr: fmtPct(c.ctr),
          pos: c.position ? `${c.position.toFixed(1)}` : '—',
          posChange: '',
          up: true,
          spark: null,
        }))
    : sampleOn ? samplePosts : [];
  // Live: Post | Published | Views | Clicks | Impressions | CTR | Avg pos
  // (every article). Sample keeps the illustrative 30-day trend sparkline
  // column and has no real publish dates to show.
  const tableCols = articlesLive ? '1fr 100px 90px 100px 120px 80px 90px' : '1fr 110px 120px 80px 90px 110px';

  // ── rank distribution ───────────────────────────────────────────────────────
  // Positions 1–3 is the one band worth calling out (page-one, top of search);
  // the rest is a plain grey ramp rather than diluting lime into a second
  // "almost as important" tier.
  const RANK_COLORS = ['#3de8bb', '#7fb6e6', '#c9a3e6', '#a374d6'];
  const rankDef = data.ranking
    ? data.ranking.bands.map((b, i) => ({ label: b.label, count: b.count, color: RANK_COLORS[i] ?? '#a374d6' }))
    : sampleOn
    ? [
        { label: 'Positions 1–3', count: 42, color: '#3de8bb' },
        { label: 'Positions 4–10', count: 76, color: '#7fb6e6' },
        { label: 'Positions 11–20', count: 58, color: '#c9a3e6' },
        { label: 'Positions 21+', count: 38, color: '#a374d6' },
      ]
    : [];
  const rankTotal = rankDef.reduce((a, b) => a + b.count, 0);
  // Guard the divide: an empty band list would make every width NaN%.
  const rankBands = rankDef.map((b) => ({ ...b, pct: (rankTotal ? Math.round((b.count / rankTotal) * 100) : 0) + '%' }));

  // Same four-color ramp as rank distribution — one accent hue per row so the
  // citations/funnel cards read as a system, not a wash of solid green.
  const SERIES_COLORS = ['#3de8bb', '#7fb6e6', '#c9a3e6', '#a374d6'];
  const engines = data.answers
    ? data.answers.byEngine.map((e, i) => ({ name: e.name, count: String(e.count), pct: `${e.pct}%`, color: SERIES_COLORS[i] ?? SERIES_COLORS[SERIES_COLORS.length - 1] }))
    : sampleOn
    ? [
        { name: 'ChatGPT', count: '186', pct: '88%', color: SERIES_COLORS[0] },
        { name: 'Google AI Overviews', count: '142', pct: '67%', color: SERIES_COLORS[1] },
        { name: 'Perplexity', count: '73', pct: '34%', color: SERIES_COLORS[2] },
      ]
    : [];

  const funnelDef = data.funnel
    ? (() => {
        const f = data.funnel!;
        const rate = (n: number) => (f.clicks > 0 ? `${Math.round((n / f.clicks) * 100)}%` : '0%');
        return [
          { label: 'Clicks to blog', value: fmtCompact(f.clicks), rate: '100%', pct: '100%', bar: SERIES_COLORS[0] },
          { label: 'Read past 50%', value: fmtCompact(f.read50), rate: rate(f.read50), pct: rate(f.read50), bar: SERIES_COLORS[1] },
          { label: 'Converted (CTA)', value: fmtCompact(f.converted), rate: rate(f.converted), pct: rate(f.converted), bar: SERIES_COLORS[2] },
        ];
      })()
    : sampleOn
    ? [
        { label: 'Clicks to blog', value: '48.2k', rate: '100%', pct: '100%', bar: SERIES_COLORS[0] },
        { label: 'Read past 50%', value: '21.7k', rate: '45%', pct: '45%', bar: SERIES_COLORS[1] },
        { label: 'Email captured', value: '3,180', rate: '6.6%', pct: '28%', bar: SERIES_COLORS[2] },
        { label: 'Started trial', value: '742', rate: '1.5%', pct: '14%', bar: SERIES_COLORS[3] },
      ]
    : [];

  // Marks a card that is showing illustrative numbers. Keyed off `sampleOn`,
  // not `anyLive` — the chip has to appear on EVERY invented figure, and the
  // account with nothing live is precisely the one that needs it most.
  const sampleTag = (isSample: boolean) => (sampleOn && isSample
    ? <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '3px 8px' }}>sample</span>
    : null);

  /** Card-body placeholder for a section with nothing measured and no sample. */
  const noData = (label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120, padding: '28px 14px', textAlign: 'center', fontSize: 12.5, color: 'var(--gv-faint)', lineHeight: 1.6 }}>
      {label}
    </div>
  );

  return (
    <>
      {/* ============ TOP BAR ============ */}
      <DashHeader title={t('Analytics')} subtitle={`${hostname} · how the blog is compounding`} />

      {/* ============ BODY ============ */}
      <div className="gv-body" style={{ maxWidth: 1680 }}>

        {/* report controls — relocated out of the nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', padding: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, gap: 3, opacity: pending ? 0.6 : 1, transition: 'opacity .2s' }}>
            {periodDef.map((p) => {
              const on = period === p.key;
              return (
                <button key={p.key} onClick={() => setPeriod(p.key)} disabled={pending} style={{ border: 'none', cursor: pending ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 999, transition: '.2s', background: on ? ACCENT : 'transparent', color: on ? 'var(--gv-on-accent)' : 'var(--gv-dim)' }}>{p.label}</button>
              );
            })}
          </div>
          <GoogleConnect configured={configured} connected={connected} verified={verified} />
          <AskAgent prompt="/analytics What's actually driving clicks this month?" />
          <button className="gv-ghost" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.02)', color: 'var(--gv-soft)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 10, cursor: 'pointer' }}>
            <Icon name="download" /> {t('Export')}
          </button>
        </div>

        {/* summary line */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 22 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0 }}>{t('Performance report')}</h1>
            {/* The headline states numbers ONLY when they are the customer's own.
                With nothing measured it says so — it never borrows a figure from
                the illustrative set, which is how "your content earned 48,210
                clicks" came to greet accounts that had published nothing. */}
            <p style={{ fontSize: 14, color: 'var(--gv-dim)', margin: '6px 0 0' }}>
              {anyLive ? (
                <>Over the {curP.range}, your content earned <span style={{ color: 'var(--gv-ink)', fontWeight: 600 }}>{fmtCompact(live?.clicks ?? 0)} clicks</span>
                  {data.answers
                    ? <> and <span style={{ color: 'var(--gv-ink)', fontWeight: 600 }}>{data.answers.total.toLocaleString()} answer-engine referrals</span>.</>
                    : <>.</>}</>
              ) : sampleOn ? (
                <>{t('Example of what this report looks like once your blog is compounding.')} <span style={{ color: 'var(--gv-soft)', fontWeight: 600 }}>{t('These are not your numbers.')}</span></>
              ) : (
                <>{t('No performance data yet. Connect Search Console and publish your first articles — measurements land here as they come in.')}</>
              )}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--gv-faint)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {anyLive && <span style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT_INK, animation: 'gvPulse 2.4s ease-in-out infinite' }} />}
            {anyLive
              ? <>Synced from Search Console &amp; first-party events · {syncedAgo}</>
              : <>{t('Nothing measured yet · connect Google to start')}</>}
            {!anyLive && (
              <button
                onClick={() => setSampleOn((v) => !v)}
                style={{ border: `1px solid ${sampleOn ? 'rgba(162,255,1,0.25)' : 'rgba(255,255,255,0.1)'}`, background: sampleOn ? 'rgba(162,255,1,0.1)' : 'transparent', color: sampleOn ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: '5px 12px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}
              >
                {sampleOn ? 'Hide sample data' : 'Preview with sample data'}
              </button>
            )}
          </div>
        </div>

        {/* ============ WHOLE-SITE TRAFFIC (Google Analytics) ============ */}
        {/* GSC + first-party events only ever see blog articles; GA counts the
            whole domain — landing page, pricing, the blog index, everything —
            which is what the owner compares Grove against. Live per range. */}
        {ga && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{t('Whole-site traffic')}</span>
              <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>Google Analytics · every page, not just the blog · {curP.short}</span>
            </div>
            <div className="gv-grid4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
              {[
                { icon: 'eye', label: 'Page views', value: fmtCompact(ga.totals.views) },
                { icon: 'rankings', label: 'Active users', value: fmtCompact(ga.totals.activeUsers) },
                { icon: 'cursor', label: 'Avg. engagement', value: formatDuration(ga.totals.avgEngagementSec) },
                { icon: 'spark', label: t('Events'), value: fmtCompact(ga.totals.events) },
              ].map((k) => (
                <div key={k.label} className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 16, padding: '18px 18px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--gv-dim)', fontSize: 12 }}>
                    <span style={{ display: 'flex', color: ACCENT_INK }}><Icon name={k.icon} /></span>{k.label}
                  </div>
                  <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 12 }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* per-page breakdown — landing page + blog index + every article,
                the exact columns GA shows (views / users / engagement / events) */}
            {ga.pages.length > 0 && (
              <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{t('Pages by traffic')}</span>
                  <span style={{ fontSize: 12, color: 'var(--gv-dim)' }}>{ga.pages.length} page{ga.pages.length === 1 ? '' : 's'}</span>
                </div>
                <div className="gv-tbl" style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px 80px', padding: '11px 22px', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span>{t('Page')}</span>
                  <span style={{ textAlign: 'right' }}>{t('Views')}</span>
                  <span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Users')}</span>
                  <span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Avg. time')}</span>
                  <span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Events')}</span>
                </div>
                {ga.pages.slice(0, 15).map((p, i) => (
                  <div key={p.title + i} className="gv-row gv-tbl" style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px 110px 80px', alignItems: 'center', padding: '13px 22px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ minWidth: 0, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 16 }}>{p.title}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(p.views)}</span>
                    <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(p.activeUsers)}</span>
                    <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-soft)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatDuration(p.avgEngagementSec)}</span>
                    <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(p.events)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* First-party engagement — shown when GA isn't connected but the blog
            beacon has data, so dwell time + event count still surface. */}
        {!ga && eng && (
          <div className="gv-grid3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
            {[
              { icon: 'eye', label: 'Blog views', value: fmtCompact(eng.views), sub: `${eng.sessions.toLocaleString()} sessions` },
              { icon: 'cursor', label: 'Avg. time on page', value: formatDuration(eng.avgDwellSec), sub: 'first-party, cookieless' },
              { icon: 'spark', label: 'Events tracked', value: fmtCompact(eng.events), sub: 'views · scroll · dwell · CTA' },
            ].map((k) => (
              <div key={k.label} className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 16, padding: '18px 18px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--gv-dim)', fontSize: 12 }}>
                  <span style={{ display: 'flex', color: ACCENT_INK }}><Icon name={k.icon} /></span>{k.label}
                </div>
                <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginTop: 12 }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--gv-faint)', marginTop: 7 }}>{k.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* KPI ROW */}
        <div className="gv-grid5" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 14 }}>
          {kpiDef.map((k) => {
            const sp = k.spark && k.spark.length >= 2 ? buildPaths(k.spark, 120, 34, 4) : null;
            return (
              <div key={k.label} className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 16, padding: '18px 18px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: 'var(--gv-dim)', fontSize: 12 }}>
                  <span style={{ display: 'flex', color: ACCENT_INK }}><Icon name={k.icon} /></span>{k.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 12 }}>
                  <span style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{k.value}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 600, color: k.up ? ACCENT_INK : 'var(--gv-red)', paddingBottom: 2 }}>{k.delta}</span>
                </div>
                {sp
                  ? <svg viewBox="0 0 120 34" preserveAspectRatio="none" style={{ width: '100%', height: 30, marginTop: 12, overflow: 'visible' }}>
                      <path d={sp.area} fill={k.fill ? 'rgba(75,92,20,0.12)' : 'transparent'} stroke="none" />
                      <path d={sp.line} fill="none" stroke={ACCENT_INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    </svg>
                  : <div style={{ height: 30, marginTop: 12 }} />}
              </div>
            );
          })}
        </div>

        {/* MAIN CHART + TRAFFIC SOURCES */}
        <div className="gv-2col-wide" style={{ display: 'grid', gridTemplateColumns: '1.85fr 1fr', gap: 14, marginBottom: 14 }}>

          {/* chart */}
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Organic performance {sampleTag(!liveSeries)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--gv-faint)', marginTop: 3 }}>{t('Clicks & impressions from Google + answer engines')}</div>
              </div>
              <div style={{ display: 'flex', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gv-dim)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: ACCENT }} />{t('Clicks')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gv-dim)' }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(255,255,255,0.22)' }} />{t('Impressions')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 28, margin: '18px 0 6px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{kpiClicks}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--gv-dim)', marginTop: 3 }}>{t('Clicks')} <span style={{ color: ACCENT_INK, fontWeight: 600 }}>{clicksDelta}</span></div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--gv-soft)' }}>{kpiImpr}</div>
                <div style={{ fontSize: 12, color: 'var(--gv-dim)', marginTop: 3 }}>{t('Impressions')}</div>
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--gv-soft)' }}>{kpiCtr}</div>
                <div style={{ fontSize: 12, color: 'var(--gv-dim)', marginTop: 3 }}>{t('Avg. CTR')}</div>
              </div>
            </div>

            {chartEmpty ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: 210, marginTop: 6, border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12, padding: '0 24px', textAlign: 'center', fontSize: 12.5, color: 'var(--gv-faint)', lineHeight: 1.6 }}>
                {t('Search Console hasn’t reported any days yet.')}<br />{t('Your clicks and impressions will plot here.')}
              </div>
            ) : (
            <>
            <div style={{ position: 'relative', width: '100%', height: 210, marginTop: 6 }}>
              <svg viewBox="0 0 640 220" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible', display: 'block' }}>
                <defs>
                  <linearGradient id="gvAreaA" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.34} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* preserveAspectRatio="none" scales x/y independently, so every
                    stroke needs non-scaling-stroke — otherwise the uneven scale
                    smears round caps into a flat, calligraphy-pen look. */}
                <line x1="0" y1="40" x2="640" y2="40" stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="100" x2="640" y2="100" stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <line x1="0" y1="160" x2="640" y2="160" stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <path d={iP.line} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.5} strokeDasharray="4 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                <path d={cP.area} fill="url(#gvAreaA)" stroke="none" />
                <path d={cP.line} fill="none" stroke={ACCENT_INK} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                {chartHover !== null && (
                  <line x1={cP.pts[chartHover].x.toFixed(1)} y1="14" x2={cP.pts[chartHover].x.toFixed(1)} y2="206" stroke="rgba(255,255,255,0.14)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                )}
                {/* invisible wide hit-targets — the visible dots above are too
                    small/sparse to hover precisely at every screen size */}
                {cP.pts.map((p, i) => (
                  <rect key={i} x={p.x - (640 / cP.pts.length) / 2} y="0" width={640 / cP.pts.length} height="220" fill="transparent"
                    onMouseEnter={() => setChartHover(i)} onMouseLeave={() => setChartHover((h) => (h === i ? null : h))} style={{ cursor: 'crosshair' }} />
                ))}
              </svg>
              {/* SVG <circle> geometry stretches into an oval under
                  preserveAspectRatio="none" (non-scaling-stroke only fixes the
                  outline, not the fill shape) — plain HTML dots stay round. */}
              <span style={{
                position: 'absolute', left: `${(cP.last.x / 640) * 100}%`, top: `${(cP.last.y / 220) * 100}%`,
                width: 9, height: 9, transform: 'translate(-50%, -50%)', borderRadius: '50%',
                background: ACCENT_INK, border: '2.5px solid var(--gv-bg)', pointerEvents: 'none',
              }} />
              {chartHover !== null && (
                <span style={{
                  position: 'absolute', left: `${(cP.pts[chartHover].x / 640) * 100}%`, top: `${(cP.pts[chartHover].y / 220) * 100}%`,
                  width: 9, height: 9, transform: 'translate(-50%, -50%)', borderRadius: '50%',
                  background: ACCENT_INK, border: '2.5px solid var(--gv-bg)', pointerEvents: 'none',
                }} />
              )}
              {chartHover !== null && (
                <div style={{
                  position: 'absolute', left: `${(cP.pts[chartHover].x / 640) * 100}%`, top: `${(cP.pts[chartHover].y / 220) * 100}%`,
                  transform: `translate(${chartHover / (cP.pts.length - 1) > 0.82 ? '-100%' : chartHover / (cP.pts.length - 1) < 0.18 ? '0%' : '-50%'}, -128%)`,
                  pointerEvents: 'none', background: 'var(--gv-pop)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 9,
                  padding: '8px 11px', whiteSpace: 'nowrap', boxShadow: '0 10px 26px rgba(0,0,0,0.4)', zIndex: 5,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gv-ink)' }}>{fmtCompact(chartClicks[chartHover])} <span style={{ fontWeight: 500, color: 'var(--gv-faint)', fontSize: 11 }}>clicks</span></div>
                  <div style={{ fontSize: 11.5, color: 'var(--gv-dim)', marginTop: 2 }}>{fmtCompact(chartImpr[chartHover])} impressions</div>
                  {(chartDates?.[chartHover] || chartLabels[chartHover]) && (
                    <div style={{ fontSize: 10.5, color: 'var(--gv-fainter)', marginTop: 3 }}>{chartDates?.[chartHover] ?? chartLabels[chartHover]}</div>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--gv-fainter)', marginTop: 10 }}>
              {chartLabels.map((lab, i) => <span key={i}>{lab}</span>)}
            </div>
            </>
            )}
          </div>

          {/* traffic sources */}
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>Traffic sources {sampleTag(!data.traffic)}</div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', margin: '3px 0 16px' }}>{t('Where the clicks came from')}</div>
            {sourceDef.length === 0 ? (
              noData('No visits recorded yet. Once readers arrive, this splits them by source.')
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', width: 132, height: 132, flexShrink: 0, borderRadius: '50%', background: donutGradient }}>
                    <div style={{ position: 'absolute', inset: 19, borderRadius: '50%', background: 'var(--gv-card)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{data.traffic ? fmtCompact(data.traffic.total) : (liveOn ? fmtCompact(live!.clicks) : cur.c)}</span>
                      <span style={{ fontSize: 10, color: 'var(--gv-faint)', marginTop: 3 }}>{data.traffic ? 'total visits' : 'total clicks'}</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {sourceDef.map((s) => (
                      <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ paddingTop: 18, fontSize: 11.5, color: 'var(--gv-faint)', lineHeight: 1.55, borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 20 }}>
                  <span style={{ color: ACCENT_INK, fontWeight: 600 }}>{t('Answer engines')}</span> {data.traffic ? <>drive {answerSharePct}% of clicks to your blog.</> : <>now drive 24% of all clicks — up from 4% a quarter ago.</>}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ARTICLES TABLE — every published article when live, sample otherwise */}
        <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, padding: '18px 22px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{articlesLive ? t('Article performance') : t('Top performing content')}</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {/* `col` is the sort KEY and stays English; only its label is
                    translated. (The literals stay bare rather than wrapped in
                    msg() because `as const` needs them to keep their literal
                    types — they are registered for extraction just below.) */}
                {(articlesLive ? ['Views', 'Clicks', 'Impressions', 'CTR'] as const : ['Clicks', 'Impressions', 'CTR'] as const).map((col) => {
                  const on = sort === col;
                  return (
                    <button key={col} onClick={() => setSort(col)} style={{ border: `1px solid ${on ? 'rgba(162,255,1,0.25)' : 'rgba(255,255,255,0.08)'}`, background: on ? 'rgba(162,255,1,0.12)' : 'transparent', color: on ? 'var(--gv-ink)' : 'var(--gv-dim)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '6px 13px', borderRadius: 999, cursor: 'pointer', transition: '.2s' }}>{t(col)}</button>
                  );
                })}
              </div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--gv-dim)' }}>{articlesLive
              ? (postDef.length === 1 ? t('1 published article') : t('{n} published articles', { n: postDef.length }))
              : sampleOn ? t('Sample data') : t('Nothing published yet')}</span>
          </div>
          <div className="gv-tbl" style={{ display: 'grid', gridTemplateColumns: tableCols, padding: '11px 22px', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--gv-fainter)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span>{t('Post')}</span>
            {articlesLive && <span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Published')}</span>}
            {articlesLive && <span style={{ textAlign: 'right' }}>{t('Views')}</span>}
            <span style={{ textAlign: 'right' }}>{t('Clicks')}</span><span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Impressions')}</span><span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('CTR')}</span><span className="gv-cell-off" style={{ textAlign: 'right' }}>{t('Avg. pos')}</span>
            {!articlesLive && <span className="gv-cell-off" style={{ textAlign: 'right' }}>30-day trend</span>}
          </div>
          {postDef.map((p) => {
            const sp = p.spark ? buildPaths(p.spark, 96, 28, 3) : null;
            return (
              <div key={p.title} className="gv-row gv-tbl" style={{ display: 'grid', gridTemplateColumns: tableCols, alignItems: 'center', padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, paddingRight: 18 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(162,255,1,0.1)', border: '1px solid rgba(162,255,1,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: ACCENT_INK, flexShrink: 0 }}><Icon name="doc" /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: 'var(--gv-faint)' }}>{p.keyword}</span>
                  </span>
                </div>
                {articlesLive && (
                  <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {p.published
                      ? <time dateTime={p.published} suppressHydrationWarning>{fmtDate(p.published)}</time>
                      : '—'}
                  </span>
                )}
                {articlesLive && <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--gv-ink)' }}>{p.views}</span>}
                <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.clicks}</span>
                <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-dim)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.impr}</span>
                <span className="gv-cell-off" style={{ fontSize: 12.5, color: 'var(--gv-soft)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.ctr}</span>
                <span className="gv-cell-off" style={{ textAlign: 'right' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--gv-soft)', fontVariantNumeric: 'tabular-nums' }}>{p.pos === '—' ? '—' : `#${p.pos}`}<span style={{ fontSize: 11, fontWeight: 600, color: p.up ? ACCENT_INK : 'var(--gv-red)' }}>{p.posChange}</span></span></span>
                {!articlesLive && (
                  <span className="gv-cell-off" style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    {sp
                      ? <svg viewBox="0 0 96 28" preserveAspectRatio="none" style={{ width: 92, height: 26, overflow: 'visible' }}>
                          <path d={sp.line} fill="none" stroke={p.up ? ACCENT_INK : 'var(--gv-red)'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      : <span style={{ fontSize: 11, color: 'var(--gv-fainter)' }}>—</span>}
                  </span>
                )}
              </div>
            );
          })}
          {postDef.length === 0 && (
            <div style={{ padding: '28px 22px', textAlign: 'center', fontSize: 13, color: 'var(--gv-faint)' }}>
              {t('No published articles yet — they’ll appear here as the pipeline ships them.')}
            </div>
          )}
        </div>

        {/* BOTTOM ROW */}
        <div className="gv-grid3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>

          {/* rank distribution */}
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>Ranking distribution {sampleTag(!data.ranking)}</div>
              {rankBands.length > 0 && <span style={{ fontSize: 11.5, color: ACCENT_INK, fontWeight: 600 }}>{rankTotal} terms</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 18 }}>{t('Keyword positions on Google')}</div>
            {rankBands.length === 0 ? (
              noData('No ranking keywords yet. Articles typically start appearing within a few weeks of publishing.')
            ) : (
              <>
                <div style={{ display: 'flex', height: 7, borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
                  {rankBands.map((b) => <span key={b.label} style={{ width: b.pct, background: b.color }} />)}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                  {rankBands.map((b) => (
                    <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: b.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, color: 'var(--gv-soft)', flex: 1 }}>{b.label}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--gv-faint)', fontVariantNumeric: 'tabular-nums' }}>{b.pct}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* answer engine citations */}
          <div className="gv-card" style={{ background: 'var(--gv-card-grad)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>{data.answers ? 'Answer-engine referrals' : 'Answer-engine citations'} {sampleTag(!data.answers)}</div>
              {!data.answers && sampleOn && <span style={{ fontSize: 11, color: ACCENT_INK, fontWeight: 600 }}>▲ 41%</span>}
            </div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', margin: '3px 0 18px' }}>{data.answers ? 'Visits that came from an answer engine' : 'Times grove content was quoted'}</div>
            {engines.length === 0 ? (
              noData('No answer-engine referrals yet. ChatGPT, Perplexity and AI Overviews show up here as they cite you.')
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                  {engines.map((e) => (
                    <div key={e.name}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, marginBottom: 7 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--gv-soft)' }}><span style={{ width: 9, height: 9, borderRadius: 3, background: e.color, flexShrink: 0 }} />{e.name}</span>
                        <span style={{ fontWeight: 700 }}>{e.count}</span>
                      </div>
                      <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', width: e.pct, borderRadius: 99, background: e.color }} /></div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--gv-faint)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginTop: 18 }}>{data.answers ? 'Click-throughs only — Google AI Overviews report as regular Search.' : '75% of published posts are structured for AI Overviews.'}</div>
              </>
            )}
          </div>

          {/* conversion funnel */}
          <div className="gv-card" style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 18, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>Content funnel {sampleTag(!data.funnel)}</div>
              <span style={{ fontSize: 11.5, color: 'var(--gv-faint)' }}>{curP.short}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--gv-faint)', marginBottom: 18 }}>{t('From a click to a signup')}</div>
            {funnelDef.length === 0 ? noData('No reader journeys tracked yet. This fills in once articles are live and being read.') : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {funnelDef.map((f) => (
                <div key={f.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--gv-soft)' }}><span style={{ width: 9, height: 9, borderRadius: 3, background: f.bar, flexShrink: 0 }} />{f.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{f.value} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--gv-faint)' }}>{f.rate}</span></span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}><div style={{ height: '100%', width: f.pct, borderRadius: 99, background: f.bar }} /></div>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
