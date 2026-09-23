/**
 * Does any difficulty signal predict where a domain actually lands better
 * than DataForSEO's KD? Grades KD, the top 10's average domain rank, and the
 * #294 "grove difficulty" hypothesis (max of the two) against every
 * non-branded query a domain's Search Console has shown it for — real
 * position and clicks — plus the per-slot dead-space verdict.
 *
 * First run, oveners.com 2026-09-23: domain rank predicted the WRONG way
 * (top-20 AUC 0.31, CI [0.21, 0.43]) and the hypothesis lost to KD alone, so
 * it was reverted. The result and its mechanism are recorded in
 * lib/keywords/serp-evidence.ts. Re-run this — on more than one domain —
 * before building selection on any SERP-authority signal again.
 *
 * ── What this can and cannot say ───────────────────────────────────────────
 * Search Console only lists queries the domain ALREADY appears for, so every
 * row is a keyword the site got onto the board somewhere in the top ~100.
 * The keywords it never appeared for at all — the hardest ones — are
 * censored. That biases every correlation here TOWARD zero, so a signal that
 * survives is real, and a null is weaker evidence than it looks.
 *
 * Usage:
 *   npx vite-node scripts/difficulty-calibration.ts --dry          # dataset only, no spend
 *   npx vite-node scripts/difficulty-calibration.ts                # fetch + grade (~$0.06)
 *   npx vite-node scripts/difficulty-calibration.ts --cached       # re-grade the saved fetch
 *   … --domain <uuid> --slots                                      # + per-slot SERPs for top-10 rows
 *   … --source posts --serp                                        # page-type test (below)
 *
 * ── --source posts: the ARTICLE outcome ────────────────────────────────────
 * The default reads the whole property (gsc_metrics), where the domain's own
 * homepage competes too — and oveners' homepage is itself a tool page, so it
 * wins tool SERPs for reasons that say nothing about what an article can do.
 * `posts` reads gsc_page_queries (grove's post pages only) and takes, per
 * query, the best position any grove article reached. That is the outcome
 * a keyword planner for ARTICLES has to predict.
 *
 * ── --serp: tool SERP vs tutorial SERP (hypothesis 2, 2026-09-23) ─────────
 * Written after hypothesis 1 (domain authority) failed, from what its rows
 * suggested: oveners' articles rank on "how to X in Photoshop" SERPs held by
 * tutorials, and sink on "auto background remover" SERPs held by tool
 * homepages. Stated before fetching a single SERP, so the classifier could
 * not be tuned to the answer:
 *   H2: the larger the share of the top 10 that is TOOL pages, the worse a
 *       grove article ranks; the larger the ARTICLE/tutorial share, the better.
 *   primary outcome: grove article reached the top 20 (the outcome hypothesis
 *   1 was judged on), AUC with bootstrap CI, KD on the same rows as baseline.
 * The domain's own hosts are EXCLUDED from the composition — an article of
 * ours sitting in the top 10 would otherwise count as "an article SERP"
 * exactly when we rank, which is the outcome leaking into the predictor.
 * Live SERP API, ~$0.002/query, cached in difficulty-calibration-serps.json.
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { keywordOverview, serpSnapshot } from '../lib/keywords/dataforseo';
import { slotVerdict, GIANT_DOMAIN_RANK, type SlotSnapshot } from '../lib/keywords/serp-evidence';

/**
 * The #294 hypothesis, kept here so it can be re-graded: difficulty = the
 * harder of KD and an authority wall mapping the top 10's average domain
 * rank 350→0 … 750→100, +15 when the SERP carries app/shopping elements.
 */
const NON_ARTICLE = new Set(['app', 'shopping', 'popular_products', 'local_pack', 'map', 'hotels_pack', 'google_hotels', 'google_flights', 'jobs']);
function hypothesisDifficulty(kd: number | null, domainRank: number, features: string[]): number {
  const authority = domainRank <= 350 ? 0 : domainRank >= 750 ? 100 : Math.round(((domainRank - 350) / 400) * 100);
  const offFormat = features.some((f) => NON_ARTICLE.has(f)) ? 15 : 0;
  return Math.min(100, Math.max(kd ?? 0, authority) + offFormat);
}

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const DOMAIN = arg('--domain') ?? '610bdc4b-9569-44ea-adf3-f98d71165ea3';   // oveners.com
const BRAND = /oven|오븐|ovener/i;
const SOURCE = arg('--source') === 'posts' ? 'posts' : 'property';
const OWN_HOST = (arg('--host') ?? 'oveners.com').toLowerCase();
const CACHE = SOURCE === 'posts' ? 'difficulty-calibration-posts-raw.json' : 'difficulty-calibration-raw.json';
const SERP_CACHE = 'difficulty-calibration-serps.json';

type Row = {
  query: string; lang: 'en' | 'ko'; impressions: number; clicks: number; position: number;
  kd: number | null; domainRank: number | null; features: string[]; volume: number | null;
  snap?: SlotSnapshot | null;
};

// ── page type ─────────────────────────────────────────────────────────────
// Rules written before any SERP was fetched, then revised ONCE after a
// label audit (--audit-all) of the first 38 SERPs, which showed ~25% misfiles
// (figma plugins as forum, "How to … in Photoshop" as tool, listicles as
// other). Each revision was checked only against the page's own URL and
// title — never against how it moved the outcome; the 38-row partial result
// was inconclusive and was not the target. Frozen after that: change a rule
// only with a label audit, and say so here. Order matters: a platform verdict
// (app store, video, forum, asset marketplace) beats a URL path, a path beats
// a title. Anything unrecognised is 'other' — NOT 'article', which is the
// defaulting mistake that made scripts/serp-hostility-backtest.ts count
// remove.bg's homepage as editorial.

export type PageKind = 'tool' | 'article' | 'video' | 'forum' | 'asset' | 'app_store' | 'other';

const ARTICLE_PATH = /\/[a-z-]*blog[a-z-]*\/|\/(learning-center|learn|tutorials?|how-to|howto|guides?|articles?|news|resources|help|support|docs?|documentation|knowledge|knowledge-base|kb|academy|insights|our-insights|opinions?|posts?|magazine|stories|library|wiki|compare|comparisons?)(\/|$|-)/i;
const ARTICLE_HOST = /(^|\.)(medium\.com|gitconnected\.com|androidpolice\.com|substack\.com|dev\.to|wikipedia\.org|wikihow\.com|hubspot\.com|zapier\.com|makeuseof\.com|howtogeek\.com|lifewire\.com|techradar\.com|pcmag\.com|zdnet\.com|tomsguide\.com|creativebloq\.com)$|^(helpx|help|support|docs|learn|blog|community)\./i;
const TOOL_PATH = /\/(tools?|ai-tools|apps?|create|generate|editor|generator|online|features?|products?|plugin|plugins|extensions?|playground|models|g)(\/|$|-)|(generator|maker|creator|remover|converter|editor|remove-background|background-remover|remove-bg)(\/|$|-|\.)/i;
const TOOL_TITLE = /\b(generator|maker|creator|remover|converter|editor|online|free|free tool|try (it )?free|sign up|no sign-?up|app)\b/i;
const ARTICLE_TITLE = /^how to\b|\bhow to\b|\bguide\b|\btutorial\b|step[- ]by[- ]step|\bvs\.?\b|\b(top|best) \d+|\d+ (best|top|ways|tips)|\bwhat is\b|\bexplained\b|\btips\b|\breview\b|\bcompared\b|\bcomparison\b|\breport\b|\bsurvey\b|\bstate of\b|\btrends\b|\bexamples\b|\bnews\b/i;
/** A title that is unambiguously an article, whatever its URL says — a
 *  "/remove-background-photoshop/" path titled "How to Remove Background in
 *  Photoshop: 7 Easy Methods" is a tutorial. */
const STRONG_ARTICLE_TITLE = /^how to\b|^\d+ (best|top|ways|easy)|^(the )?(top|best) \d+|step[- ]by[- ]step|\btutorial\b|\b\d+ best\b|\bhere are the \d+|\b\d+ go-to\b|\branked\b|\bi tested\b|\b(best|top)\b[^|]*\b20\d\d\b/i;

export function pageKind(url: string, title: string): PageKind {
  let u: URL;
  try { u = new URL(url); } catch { return 'other'; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.toLowerCase();
  if (/^(play\.google\.com|apps\.apple\.com|chromewebstore\.google\.com|apps\.microsoft\.com)$/.test(host) ||
      (host === 'chrome.google.com' && path.startsWith('/webstore'))) return 'app_store';
  if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|vimeo\.com|dailymotion\.com)$/.test(host)) return 'video';
  // Plugin / GPT listings are products, and figma's live under /community/,
  // which the forum rule below would otherwise claim.
  if ((host === 'figma.com' && path.startsWith('/community/plugin')) || host === 'chatgpt.com') return 'tool';
  if (/(^|\.)(reddit\.com|quora\.com|stackoverflow\.com|stackexchange\.com|superuser\.com)$/.test(host) ||
      /^(community|forum|forums|discuss|discourse)\./.test(host) || /\/(community|forums?|discussions?|threads?|t)\//.test(path) ||
      /^(x\.com|twitter\.com|linkedin\.com|instagram\.com|threads\.net)$/.test(host) ||
      (host === 'facebook.com' && !path.startsWith('/business/help'))) return 'forum';   // community + social
  if (/\/templates?\//.test(path) || /(^|\.)(magnific\.com|awwwards\.com|saaspo\.com|landing\.love)$/.test(host)) return 'asset';
  if (/(^|\.)(flaticon|freepik|iconscout|shutterstock|istockphoto|gettyimages|vecteezy|thenounproject|envato|creativemarket|dribbble|behance|pinterest|etsy|craftwork|ui8|icons8|iconfinder)\.[a-z.]+$/.test(host)) return 'asset';
  if (ARTICLE_PATH.test(path) || ARTICLE_HOST.test(host) || STRONG_ARTICLE_TITLE.test(title)) return 'article';
  if (TOOL_PATH.test(path)) return 'tool';
  if (ARTICLE_TITLE.test(title)) return 'article';
  const depth = path.split('/').filter(Boolean).length;
  if (depth <= 2 && TOOL_TITLE.test(title)) return 'tool';
  if (depth === 0) return 'tool';   // a bare homepage ranking for a non-brand query is a product page
  return 'other';
}

type SerpSlotLite = { rank: number; url: string; host: string; title: string };

async function fetchSerp(keyword: string, lang: 'en' | 'ko'): Promise<SerpSlotLite[] | null> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64');
  try {
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify([{ keyword, location_code: lang === 'ko' ? 2410 : 2840, language_code: lang, depth: 10 }]),
    });
    const json: any = await res.json();
    const task = json?.tasks?.[0];
    if (task?.status_code !== 20000) { console.error(`  SERP ${task?.status_code} ${task?.status_message} "${keyword}"`); return null; }
    return (task?.result?.[0]?.items ?? [])
      .filter((it: any) => it?.type === 'organic' && it?.url)
      .map((it: any) => ({
        rank: Number(it.rank_group ?? 0), url: String(it.url),
        host: String(it.domain ?? '').toLowerCase().replace(/^www\./, ''), title: String(it.title ?? ''),
      }))
      .slice(0, 10);
  } catch (e) {
    console.error(`  SERP error "${keyword}": ${(e as Error).message}`);
    return null;
  }
}

const isOwn = (host: string) => host === OWN_HOST || host.endsWith(`.${OWN_HOST}`);

function composition(slots: SerpSlotLite[]): { tool: number; article: number; n: number; kinds: string } {
  const others = slots.filter((s) => !isOwn(s.host));
  const kinds = others.map((s) => pageKind(s.url, s.title));
  const n = kinds.length;
  const letter: Record<PageKind, string> = { tool: 'T', article: 'A', video: 'V', forum: 'F', asset: 'S', app_store: 'P', other: '·' };
  return {
    tool: n ? kinds.filter((k) => k === 'tool').length / n : 0,
    article: n ? kinds.filter((k) => k === 'article').length / n : 0,
    n,
    kinds: kinds.map((k) => letter[k]).join(''),
  };
}

/** Search operators, pasted prompts, URLs — not queries anyone would target. */
const junk = (q: string) =>
  q.length > 80 || /context:|site:|["%+]|https?:|\bquestion:/i.test(q) || q.split(/\s+/).length > 12;

async function loadQueries(): Promise<Omit<Row, 'kd' | 'domainRank' | 'features' | 'volume'>[]> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  if (SOURCE === 'posts') return loadPostQueries(db);
  const rows: any[] = [];
  // PostgREST truncates at 1,000 rows silently; page explicitly.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('gsc_metrics')
      .select('key, impressions, clicks, position')
      .eq('domain_id', DOMAIN).eq('dimension', 'query').range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const agg = new Map<string, { i: number; c: number; pw: number }>();
  for (const r of rows) {
    const q = String(r.key ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) continue;
    const a = agg.get(q) ?? { i: 0, c: 0, pw: 0 };
    const i = Number(r.impressions ?? 0);
    a.i += i; a.c += Number(r.clicks ?? 0); a.pw += Number(r.position ?? 0) * i;
    agg.set(q, a);
  }
  return [...agg.entries()]
    .filter(([q, a]) => a.i >= 5 && !BRAND.test(q) && !junk(q))
    .map(([q, a]) => ({
      query: q, lang: /[가-힣]/.test(q) ? 'ko' as const : 'en' as const,
      impressions: a.i, clicks: a.c, position: a.pw / a.i,
    }));
}

/**
 * Per query, the best position any grove ARTICLE reached (impression-
 * weighted within each page, then the best page), with impressions and
 * clicks summed across grove's pages.
 */
async function loadPostQueries(db: any): Promise<Omit<Row, 'kd' | 'domainRank' | 'features' | 'volume'>[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('gsc_page_queries')
      .select('page, query, impressions, clicks, position')
      .eq('domain_id', DOMAIN).not('post_id', 'is', null).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const byPage = new Map<string, { q: string; i: number; c: number; pw: number }>();
  for (const r of rows) {
    const q = String(r.query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!q) continue;
    const key = `${q}\u0000${r.page}`;
    const a = byPage.get(key) ?? { q, i: 0, c: 0, pw: 0 };
    const i = Number(r.impressions ?? 0);
    a.i += i; a.c += Number(r.clicks ?? 0); a.pw += Number(r.position ?? 0) * i;
    byPage.set(key, a);
  }
  const byQuery = new Map<string, { i: number; c: number; best: number }>();
  for (const a of byPage.values()) {
    if (!a.i) continue;
    const b = byQuery.get(a.q) ?? { i: 0, c: 0, best: Infinity };
    b.i += a.i; b.c += a.c; b.best = Math.min(b.best, a.pw / a.i);
    byQuery.set(a.q, b);
  }
  return [...byQuery.entries()]
    .filter(([q, a]) => a.i >= 5 && !BRAND.test(q) && !junk(q))
    .map(([q, a]) => ({
      query: q, lang: /[가-힣]/.test(q) ? 'ko' as const : 'en' as const,
      impressions: a.i, clicks: a.c, position: a.best,
    }));
}

// ── statistics ────────────────────────────────────────────────────────────
function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length < 6) return null;
  const rank = (v: number[]) => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
/** P(a positive scores LOWER difficulty than a negative) — higher = the score predicts success. */
function auc(rows: { s: number; pos: boolean }[]): { auc: number; p: number; n: number } | null {
  const p = rows.filter((r) => r.pos).map((r) => r.s), q = rows.filter((r) => !r.pos).map((r) => r.s);
  if (!p.length || !q.length) return null;
  let w = 0; for (const a of p) for (const b of q) w += a < b ? 1 : a === b ? 0.5 : 0;
  return { auc: w / (p.length * q.length), p: p.length, n: q.length };
}
/** Bootstrap 90% interval for an AUC, so a 0.6 on 30 rows is read as the noise it is. */
function aucCI(rows: { s: number; pos: boolean }[], iters = 2000): [number, number] | null {
  const out: number[] = [];
  for (let k = 0; k < iters; k++) {
    const s = rows.map(() => rows[Math.floor(Math.random() * rows.length)]);
    const a = auc(s); if (a) out.push(a.auc);
  }
  if (out.length < 100) return null;
  out.sort((a, b) => a - b);
  return [out[Math.floor(out.length * 0.05)], out[Math.floor(out.length * 0.95)]];
}
const f2 = (v: number | null | undefined) => (v == null ? '  —  ' : v.toFixed(2));
const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  let rows: Row[];
  if (process.argv.includes('--cached') && existsSync(CACHE)) {
    rows = JSON.parse(readFileSync(CACHE, 'utf8')).rows;
    console.log(`cached: ${rows.length} rows`);
  } else {
    const qs = await loadQueries();
    const en = qs.filter((q) => q.lang === 'en'), ko = qs.filter((q) => q.lang === 'ko');
    console.log(`${qs.length} non-branded queries ≥5 impressions (${en.length} en, ${ko.length} ko), ` +
      `${qs.reduce((s, q) => s + q.impressions, 0)} impressions, ${qs.reduce((s, q) => s + q.clicks, 0)} clicks`);
    if (process.argv.includes('--dry')) return;
    const sized = new Map<string, any>();
    for (const [lang, list] of [['en', en], ['ko', ko]] as const) {
      if (!list.length) continue;
      const res = await keywordOverview(list.map((q) => q.query), lang, { timeoutMs: 60_000 });
      if (!res) { console.error(`overview failed for ${lang}`); continue; }
      for (const k of res) sized.set(k.keyword.toLowerCase(), k);
    }
    rows = qs.map((q) => {
      const k = sized.get(q.query);
      return {
        ...q, kd: k?.difficulty ?? null, domainRank: k?.serp?.domainRank ?? null,
        features: k?.serp?.features ?? [], volume: k?.volume ?? null,
      };
    });
    if (process.argv.includes('--slots')) {
      const top = rows.filter((r) => r.position <= 10 && r.domainRank != null);
      for (let i = 0; i < top.length; i += 8) {
        const b = top.slice(i, i + 8);
        const snaps = await Promise.all(b.map((r) => serpSnapshot(r.query, r.lang)));
        b.forEach((r, j) => { r.snap = snaps[j]; });
      }
    }
    writeFileSync(CACHE, JSON.stringify({ at: new Date().toISOString(), domain: DOMAIN, rows }, null, 1));
  }

  const m = rows.filter((r) => r.domainRank != null);
  console.log(`\n${rows.length} queries, ${m.length} with Labs authority data (${rows.length - m.length} unknown to Labs)`);
  console.log(`impressions covered: ${m.reduce((s, r) => s + r.impressions, 0)} of ${rows.reduce((s, r) => s + r.impressions, 0)}`);

  const gd = (r: Row) => hypothesisDifficulty(r.kd, r.domainRank!, r.features);
  const kdOrZero = (r: Row) => r.kd ?? 0;

  console.log('\n── does the score predict POSITION? (Spearman vs avg position; + = harder → worse, which is right)');
  for (const [name, fn] of [['provider KD', kdOrZero], ['avg domain rank', (r: Row) => r.domainRank!], ['#294 hypothesis', gd]] as const) {
    console.log(`  ${name.padEnd(18)} ρ = ${f2(spearman(m.map(fn), m.map((r) => r.position)))}   (n=${m.length})`);
  }

  for (const [label, test] of [
    ['reached the top 10', (r: Row) => r.position <= 10],
    ['reached the top 20', (r: Row) => r.position <= 20],
    ['earned ≥1 click', (r: Row) => r.clicks > 0],
  ] as const) {
    console.log(`\n── AUC for "${label}" (0.5 = chance; >0.5 = lower score → success)`);
    for (const [name, fn] of [['provider KD', kdOrZero], ['avg domain rank', (r: Row) => r.domainRank!], ['#294 hypothesis', gd]] as const) {
      const data = m.map((r) => ({ s: fn(r), pos: test(r) }));
      const a = auc(data), ci = aucCI(data);
      console.log(`  ${name.padEnd(18)} AUC ${f2(a?.auc)}  90% CI [${f2(ci?.[0])}, ${f2(ci?.[1])}]  (${a?.p ?? 0} yes / ${a?.n ?? 0} no)`);
    }
  }

  console.log('\n── by avg domain rank band (the thresholds under test: authority wall 350→750, giants ≥ 650)');
  console.log('  band        n   median pos  top10%  impr    clicks  CTR    CTR when top-10');
  const bands: [string, number, number][] = [['<400', 0, 400], ['400-500', 400, 500], ['500-600', 500, 600], ['600-650', 600, 650], ['650-750', 650, 750], ['≥750', 750, 1001]];
  for (const [name, lo, hi] of bands) {
    const b = m.filter((r) => r.domainRank! >= lo && r.domainRank! < hi);
    if (!b.length) { console.log(`  ${name.padEnd(9)} ${'0'.padStart(4)}`); continue; }
    const i = b.reduce((s, r) => s + r.impressions, 0), c = b.reduce((s, r) => s + r.clicks, 0);
    const t = b.filter((r) => r.position <= 10);
    const ti = t.reduce((s, r) => s + r.impressions, 0), tc = t.reduce((s, r) => s + r.clicks, 0);
    console.log(`  ${name.padEnd(9)} ${String(b.length).padStart(4)}   ${median(b.map((r) => r.position)).toFixed(1).padStart(6)}     ` +
      `${((t.length / b.length) * 100).toFixed(0).padStart(3)}%  ${String(i).padStart(6)}  ${String(c).padStart(5)}  ${((c / Math.max(1, i)) * 100).toFixed(2).padStart(5)}%  ` +
      `${ti ? ((tc / ti) * 100).toFixed(2) + '%' : '—'} (${tc}/${ti})`);
  }

  console.log('\n── the KD-0 trap: rows with KD < 15, split at the giant line');
  for (const [name, test] of [['KD<15, dr < 650', (r: Row) => r.domainRank! < GIANT_DOMAIN_RANK], ['KD<15, dr ≥ 650', (r: Row) => r.domainRank! >= GIANT_DOMAIN_RANK]] as const) {
    const b = m.filter((r) => (r.kd ?? 0) < 15 && test(r));
    const i = b.reduce((s, r) => s + r.impressions, 0), c = b.reduce((s, r) => s + r.clicks, 0);
    console.log(`  ${name.padEnd(17)} n=${String(b.length).padStart(3)}  median pos ${median(b.map((r) => r.position)).toFixed(1)}  top10 ${b.filter((r) => r.position <= 10).length}  clicks ${c}/${i} impr`);
  }

  const withSnap = m.filter((r) => r.snap);
  if (withSnap.length) {
    console.log(`\n── per-slot (historical_serps) for ${withSnap.length} rows oveners holds in the top 10`);
    for (const [name, dead] of [['slot verdict: open', false], ['slot verdict: DEAD', true]] as const) {
      const b = withSnap.filter((r) => slotVerdict(r.snap!, 'oveners.com').deadSpace === dead);
      const i = b.reduce((s, r) => s + r.impressions, 0), c = b.reduce((s, r) => s + r.clicks, 0);
      console.log(`  ${name.padEnd(20)} n=${String(b.length).padStart(3)}  clicks ${c}/${i} impr  CTR ${((c / Math.max(1, i)) * 100).toFixed(2)}%`);
    }
  }

  if (process.argv.includes('--serp')) await serpReport(rows);

  console.log('\n── every measured row, easiest first (#294 hypothesis)');
  for (const r of [...m].sort((a, b) => gd(a) - gd(b))) {
    console.log(`  gd ${String(gd(r)).padStart(3)}  kd ${String(r.kd ?? '—').padStart(3)}  dr ${String(Math.round(r.domainRank!)).padStart(4)}  ` +
      `pos ${r.position.toFixed(1).padStart(5)}  ${String(r.clicks).padStart(3)}/${String(r.impressions).padEnd(5)} ${r.query}` +
      (r.snap ? `  [slots: ${slotVerdict(r.snap, 'oveners.com').deadSpace ? 'DEAD' : 'open'}]` : ''));
  }
}

async function serpReport(rows: Row[]) {
  const cache: Record<string, SerpSlotLite[] | null> = existsSync(SERP_CACHE) ? JSON.parse(readFileSync(SERP_CACHE, 'utf8')) : {};
  // A null is a FAILED fetch (402 when the account runs dry, a timeout), not
  // "this query has no SERP" — retry it rather than grading around a hole.
  const todo = rows.filter((r) => cache[r.query] == null);
  if (todo.length && process.argv.includes('--no-fetch')) {
    console.log(`\n${todo.length} queries have no cached SERP; --no-fetch, so they are left out`);
  } else if (todo.length) {
    console.log(`\nfetching ${todo.length} live SERPs (~$${(todo.length * 0.002).toFixed(2)}) …`);
    for (let i = 0; i < todo.length; i += 10) {
      const b = todo.slice(i, i + 10);
      const got = await Promise.all(b.map((r) => fetchSerp(r.query, r.lang)));
      b.forEach((r, j) => { cache[r.query] = got[j]; });
      writeFileSync(SERP_CACHE, JSON.stringify(cache));
    }
  }
  const rs = rows
    .map((r) => ({ r, s: cache[r.query] }))
    .filter((x): x is { r: Row; s: SerpSlotLite[] } => !!x.s && x.s.length > 0)
    .map(({ r, s }) => ({ r, c: composition(s), s }));

  console.log(`\n══ H2: tool SERP vs tutorial SERP — ${SOURCE} outcome, ${rs.length} queries with a SERP ══`);
  const all: PageKind[] = rs.flatMap(({ s }) => s.filter((x) => !isOwn(x.host)).map((x) => pageKind(x.url, x.title)));
  const tally = new Map<string, number>(); for (const k of all) tally.set(k, (tally.get(k) ?? 0) + 1);
  console.log('  slot kinds: ' + [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n} (${((n / all.length) * 100).toFixed(0)}%)`).join(', '));

  const tests: [string, (r: Row) => boolean][] = [
    ['reached the top 20 (PRIMARY)', (r) => r.position <= 20],
    ['reached the top 10', (r) => r.position <= 10],
    ['earned ≥1 click', (r) => r.clicks > 0],
  ];
  for (const [label, test] of tests) {
    console.log(`\n── AUC "${label}" (>0.5 = the predictor points the right way)`);
    const lines: [string, { s: number; pos: boolean }[]][] = [
      ['tool share (higher = harder)', rs.map((x) => ({ s: x.c.tool, pos: test(x.r) }))],
      ['article share (higher = easier)', rs.map((x) => ({ s: -x.c.article, pos: test(x.r) }))],
    ];
    const withKd = rs.filter((x) => x.r.kd != null);
    lines.push([`  same ${withKd.length} rows that have KD: tool share`, withKd.map((x) => ({ s: x.c.tool, pos: test(x.r) }))]);
    lines.push([`  same ${withKd.length} rows that have KD: KD`, withKd.map((x) => ({ s: x.r.kd!, pos: test(x.r) }))]);
    for (const [name, data] of lines) {
      const a = auc(data), ci = aucCI(data);
      console.log(`  ${name.padEnd(42)} AUC ${f2(a?.auc)}  90% CI [${f2(ci?.[0])}, ${f2(ci?.[1])}]  (${a?.p ?? 0} yes / ${a?.n ?? 0} no)`);
    }
  }
  console.log(`\n  Spearman(tool share, position)    ρ = ${f2(spearman(rs.map((x) => x.c.tool), rs.map((x) => x.r.position)))}  (+ = right direction)`);
  console.log(`  Spearman(article share, position) ρ = ${f2(spearman(rs.map((x) => x.c.article), rs.map((x) => x.r.position)))}  (− = right direction)`);

  console.log('\n── by tool share of the top 10');
  console.log('  band       n   median pos  top20%  top10%  impr   clicks');
  for (const [name, lo, hi] of [['0-10%', 0, 0.1], ['10-30%', 0.1, 0.3], ['30-50%', 0.3, 0.5], ['≥50%', 0.5, 1.01]] as [string, number, number][]) {
    const b = rs.filter((x) => x.c.tool >= lo && x.c.tool < hi);
    if (!b.length) { console.log(`  ${name.padEnd(8)} ${'0'.padStart(3)}`); continue; }
    const pct = (f: (r: Row) => boolean) => `${((b.filter((x) => f(x.r)).length / b.length) * 100).toFixed(0).padStart(3)}%`;
    console.log(`  ${name.padEnd(8)} ${String(b.length).padStart(3)}   ${median(b.map((x) => x.r.position)).toFixed(1).padStart(6)}     ${pct((r) => r.position <= 20)}    ${pct((r) => r.position <= 10)}  ` +
      `${String(b.reduce((s, x) => s + x.r.impressions, 0)).padStart(5)}  ${String(b.reduce((s, x) => s + x.r.clicks, 0)).padStart(5)}`);
  }

  // The classifier is the weakest link, so it is shown, not trusted: every
  // row with its slot string (T tool, A article, V video, F forum, S asset,
  // P app store, · other), and a sample of each kind's verdicts to audit.
  console.log('\n── rows by position (T tool · A article · V video · F forum · S asset · P app store · · other)');
  for (const x of [...rs].sort((a, b) => a.r.position - b.r.position)) {
    console.log(`  pos ${x.r.position.toFixed(1).padStart(5)}  tool ${(x.c.tool * 100).toFixed(0).padStart(3)}%  ${x.c.kinds.padEnd(10)}  ${String(x.r.clicks).padStart(2)}/${String(x.r.impressions).padEnd(4)} kd ${String(x.r.kd ?? '—').padStart(3)}  ${x.r.query}`);
  }
  if (process.argv.includes('--audit') || process.argv.includes('--audit-all')) {
    console.log(`\n── classifier audit: ${process.argv.includes('--audit-all') ? 'every slot' : '12 random slots per kind'}`);
    const bykind = new Map<PageKind, SerpSlotLite[]>();
    for (const { s } of rs) for (const x of s) if (!isOwn(x.host)) {
      const k = pageKind(x.url, x.title); bykind.set(k, [...(bykind.get(k) ?? []), x]);
    }
    for (const [k, list] of bykind) {
      console.log(`  [${k}]`);
      const n = process.argv.includes('--audit-all') ? list.length : 12;
      for (const x of [...list].sort(() => Math.random() - 0.5).slice(0, n)) console.log(`     ${x.url.slice(0, 90).padEnd(90)}  ${x.title.slice(0, 60)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
