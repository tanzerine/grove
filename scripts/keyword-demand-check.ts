/**
 * Do grove's commissioned keywords have enough demand to produce an impression?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Two hypotheses for why 30 of 51 aged posts earned nothing have now been
 * tested and both failed:
 *
 *   1. Draft quality — scripts/jev-rank-backtest.ts. A calibrated System One
 *      model, given the article, predicted rank at AUC 0.55. No signal.
 *   2. SERP composition — scripts/serp-hostility-backtest.ts. Hostility scored
 *      AUC 0.439, i.e. slightly the WRONG WAY, and 34 of 51 target SERPs are
 *      almost entirely editorial. grove is not losing to app stores and asset
 *      marketplaces; it is losing on ordinary article SERPs it could win.
 *
 * That leaves the possibility both earlier scripts kept pointing at: the pages
 * rank, and nobody searches. The Jev run already showed its shape — 131 of 220
 * (page, query) pairs sit in the top 10 while the whole set produced 570
 * impressions. Ranking first for a phrase with three searches a month earns
 * nothing, and no scorer anywhere in the pipeline can fix that.
 *
 * A signal here would be the third strike and would settle where the work
 * belongs: not in a pre-publish gate, but in keyword selection.
 *
 * ── The trap this must not fall into ───────────────────────────────────────
 * Absence from DataForSEO Labs is NOT proof of zero demand. Measured on
 * oveners.com (2026-09-16), 17 of the site's top 20 real GSC queries were not
 * in Labs at all, and "3d icon generator" was sold as 20/mo while showing the
 * domain's page-2 result 627 times in 28 days. So "missing" is reported as its
 * own category and never silently folded into "zero" — the point of this
 * script is to find out which of the two it is, by joining against outcomes
 * that were actually observed.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * keyword_overview batches every keyword into ONE Labs task: about $0.012.
 *
 *   npx vite-node scripts/keyword-demand-check.ts
 */
import './_env';
import { createClient } from '@supabase/supabase-js';
import { dataforseoConfigured, keywordOverview } from '../lib/keywords/dataforseo';
import type { LangCode } from '../lib/language';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

type Row = {
  keyword: string;
  lang: string;
  impressions: number;
  earnedAny: boolean;
  /** null = Labs has no row for this phrase at all. Distinct from 0. */
  volume: number | null;
  inLabs: boolean;
};

/** Mann-Whitney AUC. */
function auc(rows: { score: number; pos: boolean }[]): { auc: number; nPos: number; nNeg: number } | null {
  const pos = rows.filter((r) => r.pos).map((r) => r.score);
  const neg = rows.filter((r) => !r.pos).map((r) => r.score);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return { auc: wins / (pos.length * neg.length), nPos: pos.length, nNeg: neg.length };
}

async function load(): Promise<Row[]> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: posts } = await db
    .from('posts')
    .select('id, body_md, strategy_id, slot_id, domains(language)')
    .eq('status', 'published')
    .lt('published_at', cutoff);

  const { data: strategies } = await db.from('strategies').select('id, publishing_plan');
  const kwBySlot = new Map<string, string>();
  for (const s of strategies ?? []) {
    for (const slot of (s.publishing_plan ?? []) as { id?: string; target_keyword?: string }[]) {
      const kw = (slot?.target_keyword ?? '').trim();
      if (slot?.id && kw) kwBySlot.set(`${s.id}::${slot.id}`, kw);
    }
  }

  type G = { post_id: string; query: string; impressions: number };
  const gsc: G[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from('gsc_page_queries')
      .select('post_id, query, impressions, date')
      .not('post_id', 'is', null)
      .order('date', { ascending: false })
      .range(from, from + 999);
    gsc.push(...((data ?? []) as G[]));
    if (!data || data.length < 1000) break;
  }
  const impressionsByPost = new Map<string, number>();
  const taken = new Set<string>();
  for (const g of gsc) {
    const k = `${g.post_id}::${g.query}`;
    if (taken.has(k)) continue;
    taken.add(k);
    impressionsByPost.set(g.post_id, (impressionsByPost.get(g.post_id) ?? 0) + (g.impressions ?? 0));
  }

  const rows: Row[] = [];
  for (const p of (posts ?? []) as Record<string, any>[]) {
    if (!p.body_md || p.body_md.length < 500) continue;
    const keyword = kwBySlot.get(`${p.strategy_id}::${p.slot_id}`);
    if (!keyword) continue;
    rows.push({
      keyword,
      lang: (p.domains as { language?: string } | null)?.language ?? 'en',
      impressions: impressionsByPost.get(p.id) ?? 0,
      earnedAny: impressionsByPost.has(p.id),
      volume: null,
      inLabs: false,
    });
  }
  return rows;
}

async function run(): Promise<void> {
  if (!dataforseoConfigured()) throw new Error('DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD are not set');
  const rows = await load();

  for (const lang of [...new Set(rows.map((r) => r.lang))]) {
    const kws = [...new Set(rows.filter((r) => r.lang === lang).map((r) => r.keyword))];
    const overview = await keywordOverview(kws, lang as LangCode);
    if (!overview) { console.error(`  Labs lookup failed for ${lang}`); continue; }
    const byKw = new Map(overview.map((k) => [norm(k.keyword), k]));
    for (const r of rows) {
      if (r.lang !== lang) continue;
      const hit = byKw.get(norm(r.keyword));
      if (hit) { r.inLabs = true; r.volume = hit.volume; }
    }
  }

  const n = rows.length;
  const missing = rows.filter((r) => !r.inLabs);
  const known = rows.filter((r) => r.inLabs && r.volume != null);

  console.log(`\n── Demand on the commissioned keyword · n=${n} ${'─'.repeat(24)}`);
  console.log(`  not in the Labs database at all : ${missing.length}`);
  console.log(`  carry a volume figure           : ${known.length}`);

  console.log('\n  Volume band → did the post earn anything:');
  const bands: [string, (v: number) => boolean][] = [
    ['0          ', (v) => v === 0],
    ['1-49       ', (v) => v >= 1 && v < 50],
    ['50-99      ', (v) => v >= 50 && v < 100],
    ['100-499    ', (v) => v >= 100 && v < 500],
    ['500+       ', (v) => v >= 500],
  ];
  for (const [label, test] of bands) {
    const b = known.filter((r) => test(r.volume!));
    if (!b.length) continue;
    const earned = b.filter((r) => r.earnedAny).length;
    const med = b.map((r) => r.impressions).sort((a, c) => a - c)[Math.floor(b.length / 2)];
    console.log(`    ${label} n=${String(b.length).padStart(3)}   earned ${earned}/${b.length}   median impr ${med}`);
  }
  if (missing.length) {
    const earned = missing.filter((r) => r.earnedAny).length;
    const med = missing.map((r) => r.impressions).sort((a, c) => a - c)[Math.floor(missing.length / 2)];
    console.log(`    NOT IN LABS n=${String(missing.length).padStart(3)}   earned ${earned}/${missing.length}   median impr ${med}`);
  }

  // Does bought volume predict earning anything? Missing is excluded rather
  // than coerced to zero — coercion is exactly the error this script guards.
  const a = known.length >= 8
    ? auc(known.map((r) => ({ score: r.volume!, pos: r.earnedAny })))
    : null;
  if (a) {
    const v = a.auc >= 0.7 ? 'SIGNAL' : a.auc >= 0.6 ? 'weak' : 'NO SIGNAL';
    console.log(`\n  AUC(volume → earned an impression) = ${a.auc.toFixed(3)}   (${a.nPos} earned / ${a.nNeg} not)  → ${v}`);
  } else {
    console.log(`\n  Too few keywords carry a volume to compute an AUC (${known.length}).`);
  }

  const zeroish = known.filter((r) => (r.volume ?? 0) < 50).length;
  console.log(`\n  Keywords commissioned at under 50 searches/month: ${zeroish}/${known.length} of those with a figure.`);

  console.log(`
Read this as: if most commissioned keywords are missing from Labs or sit under
~50/mo, grove is writing against phrases that cannot produce traffic however
well the article ranks — and the fix is keyword selection, not scoring. But a
keyword missing from Labs is NOT known to be dead: on oveners, 17 of the top 20
real queries were absent from this same database. Missing means unmeasured.`);
}

run().catch((e) => { console.error(e); process.exit(1); });
