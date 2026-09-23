/**
 * Does SERP COMPOSITION explain grove's failures better than keyword difficulty?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Of 51 aged published posts commissioned against a specific target keyword,
 * 30 never earned a single Search Console impression for any query at all, and
 * only ~3 ever ranked for the phrase they were written to win. Something is
 * selecting hopeless fights, and it is happening at PLANNING time — before a
 * word is written, where no draft-quality gate can reach it.
 *
 * The standing hypothesis (from the oveners grading, 2026-09-16) is that the
 * difficulty number grove buys is blind to the one thing that decides whether
 * an article can compete: WHO already holds the ten slots. DataForSEO KD is a
 * backlink count over the top 10, so a SERP owned by Play Store listings and
 * Flaticon asset pages — pages with no page-level links — comes back KD 0 and
 * reads as trivially winnable. "pixel 3d icon pack" (4,400/mo, KD 0) is an
 * Android icon-pack query; a blog post cannot take that slot at any quality or
 * any length. The plan picked it anyway, because KD said it was free.
 *
 * This script tests that hypothesis against outcomes, and — the part that
 * matters — tests it AGAINST KD on the same 51 keywords. A predictor that
 * merely correlates with failure is not interesting if KD already did. The
 * claim is specifically that composition carries information difficulty does
 * not, so both AUCs are printed side by side and the KD-0 trap is listed by
 * name.
 *
 * ── Why this is better powered than the Jev backtest ───────────────────────
 * scripts/jev-rank-backtest.ts had 3 positives in 51 and could not conclude.
 * The outcome here is "did this post ever earn a Search Console impression",
 * which splits 21/30 — balanced, and every one of the 51 posts has a value.
 * The continuous version (total impressions) uses still more of the data, so
 * both are reported. The underpowered "ranked for its exact target" outcome is
 * printed too, flagged as directional, because it is the outcome the product
 * actually promises.
 *
 * ── No future-leak, unlike a replayed rank prediction ──────────────────────
 * This reads TODAY's SERP for a keyword targeted months ago, which would be
 * fatal for predicting a rank. It is acceptable here because the quantity
 * measured is structural: whether a query is served by app stores, marketplaces
 * and asset libraries rather than by articles is a property of what people want
 * when they type it, and that does not swing week to week. It is not zero risk
 * — a SERP can be rebuilt by an algorithm update — so a NEGATIVE result is
 * weaker evidence than a positive one, and the header says so rather than the
 * conclusion pretending otherwise.
 *
 * ── The classifier does not assume its own answer ──────────────────────────
 * It would be easy to define "hostile" as the kinds I already believe are
 * hostile and then discover that hostility predicts failure. So the script
 * reports the share of each KIND separately against the outcome, and lets the
 * data say which ones matter. The single `hostility` figure (share of slots
 * that are not editorial) exists only for the head-to-head against KD.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * One live SERP call per distinct keyword, ~51 calls, roughly $0.10-0.15.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   # dataset + cost, no network, no spend
 *   npx vite-node scripts/serp-hostility-backtest.ts --dry
 *
 *   # the real run
 *   DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… npx vite-node scripts/serp-hostility-backtest.ts
 *
 * Supabase credentials resolve themselves via scripts/_env.ts (.env.local, then
 * the linked Supabase CLI), so no env incantation is needed to run this.
 */
import './_env';   // resolves Supabase + .env.local before any client is built
import { createClient } from '@supabase/supabase-js';
import { dataforseoConfigured, credentialShapeWarning, keywordOverview } from '../lib/keywords/dataforseo';
import type { LangCode } from '../lib/language';

// ── what holds a slot ──────────────────────────────────────────────────────
// Host-pattern classification, deliberately conservative: anything unrecognised
// is 'editorial', so the hostility figure is a LOWER bound and the script can
// never inflate its own hypothesis by guessing.

type SlotKind =
  | 'app_store'      // Play Store, App Store — a blog post cannot be an app listing
  | 'marketplace'    // Flaticon, Freepik, Etsy, Envato — asset/product inventory
  | 'retailer'       // Amazon, Walmart — transactional product pages
  | 'community'      // Reddit, Quora, Stack Exchange — Google boosts these, blogs rarely displace them
  | 'video'          // YouTube, TikTok — a different medium entirely
  | 'social'         // Pinterest, Instagram, Facebook
  | 'vendor_docs'    // docs.*, developer.*, support.* — first-party documentation
  | 'editorial';     // everything else: articles, which is what grove publishes

const HOST_RULES: [RegExp, SlotKind][] = [
  [/(^|\.)play\.google\.com$|(^|\.)apps\.apple\.com$|(^|\.)microsoft\.com$|chrome\.google\.com$/, 'app_store'],
  [/(^|\.)(flaticon|freepik|shutterstock|istockphoto|gettyimages|envato|creativemarket|iconfinder|thenounproject|vecteezy|etsy|dribbble|behance|canva)\.com$/, 'marketplace'],
  [/(^|\.)(amazon|walmart|bestbuy|target|ebay|aliexpress)\.[a-z.]+$/, 'retailer'],
  [/(^|\.)(reddit|quora|stackoverflow|stackexchange|superuser|serverfault)\.com$/, 'community'],
  [/(^|\.)(youtube|youtu\.be|tiktok|vimeo|dailymotion)\.[a-z.]+$/, 'video'],
  [/(^|\.)(pinterest|instagram|facebook|twitter|x|linkedin|threads)\.[a-z.]+$/, 'social'],
  [/^(docs|developer|developers|support|help|learn)\./, 'vendor_docs'],
];

export function classifyHost(host: string): SlotKind {
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const [re, kind] of HOST_RULES) if (re.test(h)) return kind;
  return 'editorial';
}

const KINDS: SlotKind[] = ['app_store', 'marketplace', 'retailer', 'community', 'video', 'social', 'vendor_docs', 'editorial'];

// ── statistics ─────────────────────────────────────────────────────────────

/** Mann-Whitney AUC: P(a random positive scores above a random negative). */
function auc(rows: { score: number | null; pos: boolean }[]): { auc: number; nPos: number; nNeg: number } | null {
  const usable = rows.filter((r) => r.score != null) as { score: number; pos: boolean }[];
  const pos = usable.filter((r) => r.pos).map((r) => r.score);
  const neg = usable.filter((r) => !r.pos).map((r) => r.score);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return { auc: wins / (pos.length * neg.length), nPos: pos.length, nNeg: neg.length };
}

/** Spearman rank correlation, average ranks for ties. */
function spearman(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 4) return null;
  const rank = (v: number[]): number[] => {
    const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(v.length);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// ── SERP fetch ─────────────────────────────────────────────────────────────

type Serp = {
  slots: { rank: number; host: string; kind: SlotKind }[];
  features: string[];   // ai_overview, featured_snippet, people_also_ask, …
};

async function fetchSerp(keyword: string, locationCode: number, langCode: string, timeoutMs = 45_000): Promise<Serp | null> {
  const login = process.env.DATAFORSEO_LOGIN!;
  const password = process.env.DATAFORSEO_PASSWORD!;
  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify([{ keyword, location_code: locationCode, language_code: langCode, depth: 10 }]),
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`  SERP HTTP ${res.status} for "${keyword}"`);
      return null;
    }
    const json: any = await res.json();
    const task = json?.tasks?.[0];
    if (task?.status_code !== 20000) {
      console.error(`  SERP task ${task?.status_code} ${task?.status_message ?? ''} for "${keyword}"`);
      return null;
    }
    const items: any[] = task?.result?.[0]?.items ?? [];

    const slots: Serp['slots'] = [];
    const features = new Set<string>();
    for (const it of items) {
      const type = String(it?.type ?? '');
      if (type === 'organic') {
        const host = String(it?.domain ?? '').trim();
        if (host) slots.push({ rank: Number(it?.rank_group ?? slots.length + 1), host, kind: classifyHost(host) });
      } else if (type) {
        features.add(type);
      }
    }
    return { slots: slots.slice(0, 10), features: [...features] };
  } catch (e) {
    console.error(`  SERP error for "${keyword}": ${(e as Error).message}`);
    return null;
  }
}

// ── dataset ────────────────────────────────────────────────────────────────

type Row = {
  postId: string;
  keyword: string;
  lang: string;
  /** Total GSC impressions this post ever earned, across every query. */
  impressions: number;
  /** Did it ever appear for anything at all? The primary, balanced outcome. */
  earnedAny: boolean;
  /** Did it rank for the phrase it was commissioned to win? Underpowered. */
  rankedForTarget: boolean;
  /** Purchased difficulty for this keyword, when the ledger has it. */
  kd: number | null;
  serp?: Serp | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function loadRows(): Promise<Row[]> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: posts, error } = await db
    .from('posts')
    .select('id, body_md, strategy_id, slot_id, domain_id, domains(language)')
    .eq('status', 'published')
    .lt('published_at', cutoff);
  if (error) throw new Error(`posts: ${error.message}`);

  const { data: strategies, error: sErr } = await db.from('strategies').select('id, publishing_plan');
  if (sErr) throw new Error(`strategies: ${sErr.message}`);
  const kwBySlot = new Map<string, string>();
  for (const s of strategies ?? []) {
    for (const slot of (s.publishing_plan ?? []) as { id?: string; target_keyword?: string }[]) {
      const kw = (slot?.target_keyword ?? '').trim();
      if (slot?.id && kw) kwBySlot.set(`${s.id}::${slot.id}`, kw);
    }
  }

  // Paged: PostgREST silently truncates at 1,000 rows.
  type G = { post_id: string; query: string; impressions: number; date: string };
  const gsc: G[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: gErr } = await db
      .from('gsc_page_queries')
      .select('post_id, query, impressions, date')
      .not('post_id', 'is', null)
      .order('date', { ascending: false })
      .range(from, from + 999);
    if (gErr) throw new Error(`gsc_page_queries: ${gErr.message}`);
    gsc.push(...((data ?? []) as G[]));
    if (!data || data.length < 1000) break;
  }
  // Latest snapshot per (post, query) — rows arrive newest-first.
  const seen = new Map<string, { query: string; impressions: number }[]>();
  const taken = new Set<string>();
  for (const g of gsc) {
    const k = `${g.post_id}::${g.query}`;
    if (taken.has(k)) continue;
    taken.add(k);
    const list = seen.get(g.post_id) ?? [];
    list.push({ query: g.query, impressions: g.impressions });
    seen.set(g.post_id, list);
  }

  const { data: cands } = await db.from('keyword_candidates').select('keyword, difficulty');
  const kdByKeyword = new Map<string, number>();
  for (const c of cands ?? []) {
    if (typeof c.difficulty === 'number') kdByKeyword.set(norm(c.keyword), c.difficulty);
  }

  const rows: Row[] = [];
  for (const p of (posts ?? []) as Record<string, any>[]) {
    if (!p.body_md || p.body_md.length < 500) continue;
    const keyword = kwBySlot.get(`${p.strategy_id}::${p.slot_id}`);
    if (!keyword) continue;

    const queries = seen.get(p.id) ?? [];
    const impressions = queries.reduce((s, q) => s + (q.impressions ?? 0), 0);
    const target = norm(keyword);
    const tokens = target.split(' ').filter(Boolean);
    const rankedForTarget = queries.some((q) => {
      const nq = norm(q.query);
      return nq === target || nq.includes(target) || tokens.every((t) => nq.includes(t));
    });

    rows.push({
      postId: p.id,
      keyword,
      lang: (p.domains as { language?: string } | null)?.language ?? 'en',
      impressions,
      earnedAny: queries.length > 0,
      rankedForTarget,
      kd: kdByKeyword.get(target) ?? null,
    });
  }
  return rows;
}

// ── report ─────────────────────────────────────────────────────────────────

const hostilityOf = (s: Serp): number =>
  s.slots.length ? s.slots.filter((x) => x.kind !== 'editorial').length / s.slots.length : 0;

const shareOf = (s: Serp, kind: SlotKind): number =>
  s.slots.length ? s.slots.filter((x) => x.kind === kind).length / s.slots.length : 0;

function report(rows: Row[]): void {
  const withSerp = rows.filter((r) => r.serp && r.serp.slots.length);
  console.log(`\n── Results · ${withSerp.length} keywords with a SERP ${'─'.repeat(30)}`);

  if (withSerp.length < 10) {
    console.log('  Too few SERPs fetched to say anything. Stopping.');
    return;
  }

  // ── headline: hostility vs KD on the SAME keywords, same outcome ─────────
  // "pos" is FAILURE, so a predictor of failure scores above 0.5.
  const failed = (r: Row) => !r.earnedAny;
  const hostAuc = auc(withSerp.map((r) => ({ score: hostilityOf(r.serp!), pos: failed(r) })));
  const kdRows = withSerp.filter((r) => r.kd != null);
  const kdAuc = auc(kdRows.map((r) => ({ score: r.kd, pos: failed(r) })));

  console.log('\n  Predicting FAILURE (post never earned a single impression):');
  if (hostAuc) {
    const v = hostAuc.auc >= 0.7 ? 'SIGNAL' : hostAuc.auc >= 0.6 ? 'weak' : 'NO SIGNAL';
    console.log(`    SERP hostility  AUC ${hostAuc.auc.toFixed(3)}   (${hostAuc.nPos} failed / ${hostAuc.nNeg} earned)  → ${v}`);
  }
  if (kdAuc) {
    const v = kdAuc.auc >= 0.7 ? 'SIGNAL' : kdAuc.auc >= 0.6 ? 'weak' : 'NO SIGNAL';
    console.log(`    Purchased KD    AUC ${kdAuc.auc.toFixed(3)}   (n=${kdRows.length} with a KD)          → ${v}`);
  } else {
    console.log(`    Purchased KD    not comparable — only ${kdRows.length} of these keywords carry a KD in keyword_candidates`);
  }
  if (hostAuc && kdAuc) {
    const d = hostAuc.auc - kdAuc.auc;
    console.log(`    → composition ${d > 0.05 ? 'BEATS' : d < -0.05 ? 'LOSES TO' : 'ties'} difficulty by ${Math.abs(d).toFixed(3)} AUC`);
    console.log(`      (compare on the ${kdRows.length} keywords that have both, not across different sets)`);
  }

  // ── continuous: does hostility track how much traffic was earned? ────────
  const rho = spearman(withSerp.map((r) => hostilityOf(r.serp!)), withSerp.map((r) => Math.log1p(r.impressions)));
  if (rho != null) console.log(`\n  Spearman(hostility, log impressions) = ${rho.toFixed(3)}   (expect NEGATIVE if the hypothesis holds)`);

  // ── per-kind, so the classifier can't assume its own answer ──────────────
  console.log('\n  Failure rate by who holds the slots (share of top 10 ≥ 30%):');
  for (const kind of KINDS) {
    const hit = withSerp.filter((r) => shareOf(r.serp!, kind) >= 0.3);
    if (hit.length < 3) continue;
    const failRate = hit.filter(failed).length / hit.length;
    const base = withSerp.filter(failed).length / withSerp.length;
    const arrow = failRate > base + 0.1 ? '↑ worse' : failRate < base - 0.1 ? '↓ better' : '  ≈';
    console.log(`    ${kind.padEnd(12)} n=${String(hit.length).padStart(3)}   failed ${(failRate * 100).toFixed(0).padStart(3)}%  vs ${(base * 100).toFixed(0)}% overall  ${arrow}`);
  }

  // ── hostility buckets ────────────────────────────────────────────────────
  console.log('\n  Hostility bucket → outcome:');
  for (const [lo, hi] of [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.01]]) {
    const b = withSerp.filter((r) => { const h = hostilityOf(r.serp!); return h >= lo && h < hi; });
    if (!b.length) continue;
    const earned = b.filter((r) => r.earnedAny).length;
    const med = b.map((r) => r.impressions).sort((a, c) => a - c)[Math.floor(b.length / 2)];
    console.log(`    ${lo.toFixed(2)}–${hi === 1.01 ? '1.00' : hi.toFixed(2)}  n=${String(b.length).padStart(3)}   earned impressions ${earned}/${b.length}   median impr ${med}`);
  }

  // ── the KD-0 trap, by name ───────────────────────────────────────────────
  const trap = withSerp.filter((r) => r.kd != null && r.kd <= 10 && hostilityOf(r.serp!) >= 0.5);
  console.log(`\n  The KD-0 trap — "easy" by difficulty, owned by page types an article can't be (n=${trap.length}):`);
  if (!trap.length) {
    console.log('    none found in this set');
  } else {
    for (const r of trap.slice(0, 12)) {
      const s = r.serp!;
      const kinds = [...new Set(s.slots.filter((x) => x.kind !== 'editorial').map((x) => x.kind))].join(', ');
      console.log(`    KD ${String(r.kd).padStart(3)}  hostility ${(hostilityOf(s) * 100).toFixed(0).padStart(3)}%  impr ${String(r.impressions).padStart(4)}  "${r.keyword.slice(0, 44)}"  [${kinds}]`);
    }
    const trapFail = trap.filter(failed).length;
    console.log(`    → ${trapFail}/${trap.length} of these earned nothing at all`);
  }

  // ── the underpowered outcome the product actually promises ───────────────
  const won = withSerp.filter((r) => r.rankedForTarget).length;
  console.log(`\n  Ranked for the exact commissioned keyword: ${won}/${withSerp.length} — too few to test against, reported for the record.`);

  console.log(`
Read this as: the hypothesis holds if hostility's AUC clears ~0.65 AND beats KD
on the keywords carrying both. Hostility winning while KD sits near 0.5 is the
case for reading the SERP at planning time. Both near 0.5 means composition is
not the mechanism either, and the next place to look is demand — whether these
keywords have enough search volume to produce an impression at all.
Today's SERP is being used to explain a months-old decision, so a positive
result is stronger evidence than a negative one.`);
}

// ── runner ─────────────────────────────────────────────────────────────────

const LOCATION: Record<string, number> = { en: 2840, ko: 2410, es: 2724, zh: 2156 };

async function run(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const rows = await loadRows();

  const byKeyword = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byKeyword.get(norm(r.keyword)) ?? [];
    list.push(r);
    byKeyword.set(norm(r.keyword), list);
  }

  console.log(`\nDataset`);
  console.log(`  posts with a commissioned target keyword : ${rows.length}`);
  console.log(`  distinct keywords to fetch              : ${byKeyword.size}`);
  console.log(`  earned any impression                   : ${rows.filter((r) => r.earnedAny).length}`);
  console.log(`  earned nothing at all                   : ${rows.filter((r) => !r.earnedAny).length}`);
  console.log(`  ranked for their exact target           : ${rows.filter((r) => r.rankedForTarget).length}`);
  console.log(`  carry a purchased KD                    : ${rows.filter((r) => r.kd != null).length}`);

  if (dry) {
    console.log(`\n--dry: would make ${byKeyword.size} live SERP calls ≈ $${(byKeyword.size * 0.002).toFixed(3)}`);
    console.log('Sample keywords: ' + [...byKeyword.keys()].slice(0, 6).map((k) => `"${k}"`).join(', '));
    return;
  }

  if (!dataforseoConfigured()) throw new Error('DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD are not set (use --dry to inspect the dataset)');
  const warn = credentialShapeWarning(process.env.DATAFORSEO_LOGIN!, process.env.DATAFORSEO_PASSWORD!);
  if (warn) throw new Error(warn);

  // ── KD, live ────────────────────────────────────────────────────────────
  // keyword_candidates only holds keywords gathered after the ledger existed —
  // 1 of these 51. Without KD there is no head-to-head, and the head-to-head IS
  // the argument: composition is only worth buying if it knows something
  // difficulty doesn't. keyword_overview batches up to 700 keywords into ONE
  // $0.012 task, so filling the gap costs about one cent.
  const langs = [...new Set(rows.map((r) => r.lang))];
  for (const lang of langs) {
    const kws = [...new Set(rows.filter((r) => r.lang === lang).map((r) => r.keyword))];
    const overview = await keywordOverview(kws, lang as LangCode);
    if (!overview) { console.error(`  KD lookup failed for ${lang} — the comparison will be skipped`); continue; }
    const kd = new Map(overview.map((k) => [norm(k.keyword), k.difficulty]));
    for (const r of rows) {
      if (r.lang === lang && r.kd == null) r.kd = kd.get(norm(r.keyword)) ?? null;
    }
  }
  console.log(`  KD available for ${rows.filter((r) => r.kd != null).length}/${rows.length} posts after the live lookup`);

  // Serial with a small gap: 51 calls is not a throughput problem, and a
  // burst against a paid SERP endpoint is how a rate limit turns into a
  // half-finished dataset that looks complete.
  const serpByKeyword = new Map<string, Serp | null>();
  let i = 0;
  for (const [kw, group] of byKeyword) {
    const lang = group[0].lang;
    serpByKeyword.set(kw, await fetchSerp(group[0].keyword, LOCATION[lang] ?? 2840, lang));
    if (++i % 10 === 0) console.log(`  fetched ${i}/${byKeyword.size}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const r of rows) r.serp = serpByKeyword.get(norm(r.keyword)) ?? null;

  const fetched = [...serpByKeyword.values()].filter(Boolean).length;
  console.log(`\nSERPs fetched: ${fetched}/${byKeyword.size}  ≈ $${(fetched * 0.002).toFixed(3)}`);

  await (await import('node:fs/promises')).writeFile(
    'serp-hostility-raw.json',
    JSON.stringify({ at: new Date().toISOString(), rows }, null, 2),
  );
  console.log('Raw rows + SERPs written to serp-hostility-raw.json');

  report(rows);
}

run().catch((e) => { console.error(e); process.exit(1); });
