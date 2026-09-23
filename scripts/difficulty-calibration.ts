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
const CACHE = 'difficulty-calibration-raw.json';

type Row = {
  query: string; lang: 'en' | 'ko'; impressions: number; clicks: number; position: number;
  kd: number | null; domainRank: number | null; features: string[]; volume: number | null;
  snap?: SlotSnapshot | null;
};

/** Search operators, pasted prompts, URLs — not queries anyone would target. */
const junk = (q: string) =>
  q.length > 80 || /context:|site:|["%+]|https?:|\bquestion:/i.test(q) || q.split(/\s+/).length > 12;

async function loadQueries(): Promise<Omit<Row, 'kd' | 'domainRank' | 'features' | 'volume'>[]> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
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

  console.log('\n── every measured row, easiest first (#294 hypothesis)');
  for (const r of [...m].sort((a, b) => gd(a) - gd(b))) {
    console.log(`  gd ${String(gd(r)).padStart(3)}  kd ${String(r.kd ?? '—').padStart(3)}  dr ${String(Math.round(r.domainRank!)).padStart(4)}  ` +
      `pos ${r.position.toFixed(1).padStart(5)}  ${String(r.clicks).padStart(3)}/${String(r.impressions).padEnd(5)} ${r.query}` +
      (r.snap ? `  [slots: ${slotVerdict(r.snap, 'oveners.com').deadSpace ? 'DEAD' : 'open'}]` : ''));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
