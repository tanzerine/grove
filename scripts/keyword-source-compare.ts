/**
 * Measure whether DataForSEO Labs actually beats Google Autocomplete as
 * grove's keyword candidate source — per language, on real seeds.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `lib/strategy/seeds.ts` measured that Autocomplete is a HEAD-TERM SERVICE:
 * four words is the ceiling, and the same cliff shows up in Korean ("AI 3D
 * 아이콘 생성기" → 0, "3D 아이콘 생성" → 3). That matters because the keywords
 * worth targeting are the ones few people type, and Autocomplete only returns
 * the ones many people type. The candidate pool is filtered by popularity
 * before the planner ever sees it — selected AGAINST the strategy.
 *
 * DataForSEO Labs `Keyword Suggestions` claims to expand "before, after, or
 * WITHIN the seed key phrase". Infix expansion is exactly what Autocomplete
 * cannot do, so in principle it reaches the long tail. This script checks
 * whether that is true in practice, and specifically whether it is true in
 * KOREAN — one of only two languages grove has exercised end to end, and the
 * one where a Western keyword database is most likely to be thin.
 *
 * The decision this informs: does Autocomplete get demoted from candidate
 * SOURCE to phrasing VALIDATOR, or does it stay for `ko`?
 *
 * ── SANDBOX RETURNS MOCK DATA ──────────────────────────────────────────────
 * DataForSEO's sandbox echoes fixture responses. It proves the request shape,
 * auth and parsing are right — it CANNOT answer the coverage question. Run it
 * first for free to validate wiring, then re-run with GROVE_DFS_LIVE=1 against
 * the paid endpoint for the real answer. The report says which mode produced
 * it, because a mock result that looks like a finding is the failure mode
 * worth engineering against.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   # wiring check, free, mock data
 *   DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… npx vite-node scripts/keyword-source-compare.ts
 *
 *   # real data, costs credit
 *   GROVE_DFS_LIVE=1 DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… \
 *     npx vite-node scripts/keyword-source-compare.ts
 *
 *   # autocomplete only — no DataForSEO account needed, establishes the baseline
 *   npx vite-node scripts/keyword-source-compare.ts --baseline
 *
 *   # your own seeds
 *   npx vite-node scripts/keyword-source-compare.ts --lang ko --seeds "3D 아이콘 생성,이미지 배경 제거"
 */
import { gatherKeywordDemand } from '../lib/strategy/keywords';
import { language, type LangCode } from '../lib/language';

// ── seeds ───────────────────────────────────────────────────────────────────
// Defaults are the phrases seeds.ts actually measured, so a run is comparable
// against the recorded baseline rather than against a fresh guess.
const DEFAULT_SEEDS: Record<LangCode, string[]> = {
  en: ['ai blog writing', 'blog hosting', 'seo strategy', 'topical clustering'],
  ko: ['3D 아이콘 생성', '블로그 자동화', 'SEO 전략'],
  es: ['redaccion de blogs con ia', 'estrategia seo'],
  zh: ['ai 博客写作', 'seo 策略'],
};

// Location codes DataForSEO expects. 2840 = United States, 2410 = South Korea,
// 2724 = Spain, 2156 = China. Autocomplete is steered by `hl` instead, inside
// gatherKeywordDemand — the two are not the same knob, which is itself a
// reason to compare rather than assume.
const LOCATION: Record<LangCode, number> = { en: 2840, ko: 2410, es: 2724, zh: 2156 };

// ── length, measured in the language's own unit ─────────────────────────────
/**
 * CJK gets characters, Latin gets whitespace words — the same split
 * lib/language.ts makes for article length, and for the same reason: a Korean
 * phrase read on an English word-counter looks trivially short, which would
 * make every source appear to produce nothing but head terms.
 */
function lengthOf(phrase: string, lang: LangCode): number {
  return language(lang).script === 'cjk'
    ? phrase.replace(/\s+/g, '').length
    : phrase.trim().split(/\s+/).filter(Boolean).length;
}

/** Buckets chosen around the measured Autocomplete ceiling (4 words / ~8 CJK
 *  chars). "long tail" is the bucket that decides this comparison. */
function bucketOf(n: number, lang: LangCode): string {
  const cjk = language(lang).script === 'cjk';
  const [mid, long] = cjk ? [8, 14] : [3, 5];
  if (n <= mid) return 'head';
  if (n < long) return 'mid';
  return 'long tail';
}

type Candidate = { keyword: string; volume?: number | null; kd?: number | null };

/**
 * Is Google Autocomplete actually reachable from here?
 *
 * `fetchAutocomplete` swallows every failure and returns [], by design — it is
 * best-effort signal inside the pipeline. That makes a blocked network look
 * exactly like "this seed has no demand", which is the confusion seeds.ts spent
 * a paragraph on. A measurement tool must not inherit it: a run from a network
 * that cannot reach Google would otherwise print a confident 0% long tail and
 * read as evidence against autocomplete.
 *
 * Known to matter: grove's own remote sandboxes block both this host and
 * dataforseo.com, so this script only produces findings when run locally.
 */
async function autocompleteReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(
      'https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=seo',
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return false;
    const data = JSON.parse(await res.text());
    return Array.isArray(data?.[1]) && data[1].length > 0;
  } catch {
    return false;
  }
}

// ── DataForSEO ──────────────────────────────────────────────────────────────
const LIVE = process.env.GROVE_DFS_LIVE === '1';
const DFS_BASE = LIVE ? 'https://api.dataforseo.com' : 'https://sandbox.dataforseo.com';

/**
 * Labs pricing, from the published rate card (2026-09). Every Labs endpoint
 * that matters here — keyword_suggestions, keyword_overview,
 * bulk_keyword_difficulty, keywords_for_site, search_intent — bills the same:
 * a flat task fee plus a per-result fee.
 *
 * Worth internalising, because it inverts the obvious design: the task fee is
 * 100× the result fee, so ONE call returning 1,000 keywords costs $0.132
 * ($0.000132/keyword) while 1,000 single-keyword calls cost $12.12. Batch
 * wide, call rarely. It is also why Keywords Data API is the wrong door —
 * google_ads/search_volume is $0.09 per task, 7.5× the Labs task fee, for
 * strictly less data.
 */
const DFS_TASK_COST = 0.012;
const DFS_RESULT_COST = 0.00012;
let spentTasks = 0;
let spentResults = 0;

async function dfsKeywordSuggestions(seed: string, lang: LangCode, limit: number): Promise<Candidate[]> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD');

  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const res = await fetch(`${DFS_BASE}/v3/dataforseo_labs/google/keyword_suggestions/live`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
    body: JSON.stringify([{
      keyword: seed,
      language_code: lang,
      location_code: LOCATION[lang],
      limit,
      // Ask for the two fields the whole decision turns on. If the plan is to
      // screen on difficulty, a suggestion without a KD is not a candidate.
      include_serp_info: false,
      include_seed_keyword: false,
    }]),
  });

  if (!res.ok) throw new Error(`DataForSEO ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();

  // DataForSEO nests results two levels deep and reports per-task errors in
  // the body with a 200 on the envelope — so check the task, not just the HTTP.
  const task = json?.tasks?.[0];
  if (!task) throw new Error(`no task in response: ${JSON.stringify(json).slice(0, 300)}`);
  if (task.status_code && task.status_code !== 20000) {
    throw new Error(`task ${task.status_code}: ${task.status_message}`);
  }

  const items = task?.result?.[0]?.items ?? [];
  spentTasks += 1;
  spentResults += items.length;
  return items.map((it: any): Candidate => ({
    keyword: it?.keyword ?? '',
    volume: it?.keyword_info?.search_volume ?? null,
    kd: it?.keyword_properties?.keyword_difficulty ?? null,
  })).filter((c: Candidate) => c.keyword);
}

// ── report ──────────────────────────────────────────────────────────────────
function distribution(cands: Candidate[], lang: LangCode) {
  const buckets: Record<string, number> = { head: 0, mid: 0, 'long tail': 0 };
  for (const c of cands) buckets[bucketOf(lengthOf(c.keyword, lang), lang)]++;
  return buckets;
}

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(0)}%` : '—';
}

function report(lang: LangCode, auto: Candidate[], dfs: Candidate[] | null) {
  const unit = language(lang).script === 'cjk' ? 'chars' : 'words';
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${lang.toUpperCase()}  ·  length measured in ${unit}`);
  console.log('═'.repeat(72));

  const rows: [string, Candidate[]][] = [['Autocomplete', auto]];
  if (dfs) rows.push([LIVE ? 'DataForSEO (live)' : 'DataForSEO (SANDBOX/MOCK)', dfs]);

  for (const [name, cands] of rows) {
    const d = distribution(cands, lang);
    const t = cands.length;
    console.log(`\n${name} — ${t} candidates`);
    console.log(`  head      ${String(d.head).padStart(4)}  ${pct(d.head, t)}`);
    console.log(`  mid       ${String(d.mid).padStart(4)}  ${pct(d.mid, t)}`);
    console.log(`  long tail ${String(d['long tail']).padStart(4)}  ${pct(d['long tail'], t)}   ← the bucket that decides this`);
  }

  if (!dfs) {
    console.log('\n  (baseline only — no DataForSEO comparison)');
    return;
  }

  // Overlap: how much of DataForSEO's pool did we already have for free?
  const autoSet = new Set(auto.map((c) => c.keyword.toLowerCase().trim()));
  const novel = dfs.filter((c) => !autoSet.has(c.keyword.toLowerCase().trim()));
  console.log(`\nOverlap`);
  console.log(`  already in autocomplete  ${dfs.length - novel.length}/${dfs.length}`);
  console.log(`  net new from DataForSEO  ${novel.length}/${dfs.length}  ${pct(novel.length, dfs.length)}`);

  // The money metric. A candidate is only useful if it is BOTH searched and
  // winnable; a pool full of unwinnable head terms is the thing we suspect
  // autocomplete of being. Autocomplete carries neither number, so it cannot
  // be scored here at all — which is itself the finding.
  const scored = dfs.filter((c) => c.kd != null && c.volume != null);
  if (scored.length) {
    const winnable = scored.filter((c) => (c.kd ?? 100) <= 30 && (c.volume ?? 0) >= 100);
    console.log(`\nWinnable (KD ≤ 30 and volume ≥ 100)`);
    console.log(`  ${winnable.length}/${scored.length} scored candidates  ${pct(winnable.length, scored.length)}`);
    const inAuto = winnable.filter((c) => autoSet.has(c.keyword.toLowerCase().trim())).length;
    console.log(`  of those, autocomplete already had  ${inAuto}/${winnable.length}`);
    console.log(`  → autocomplete MISSED ${winnable.length - inAuto} winnable keywords`);
    console.log(`\n  sample:`);
    for (const c of winnable.slice(0, 8)) {
      console.log(`    kd ${String(c.kd).padStart(3)}  vol ${String(c.volume).padStart(6)}  ${c.keyword}`);
    }
  } else {
    console.log(`\n  ⚠ no candidate carried both KD and volume.`);
    console.log(`    In sandbox this is expected (mock fixtures).`);
    console.log(`    On live it means keyword_suggestions omits these fields — so`);
    console.log(`    pipe the candidates through keyword_overview/live, which bills`);
    console.log(`    identically ($0.012 + $0.00012/result) and returns volume, KD,`);
    console.log(`    intent and backlink data in one call.`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const baselineOnly = argv.includes('--baseline');
  const langs: LangCode[] = (flag('lang')?.split(',') as LangCode[]) ?? ['en', 'ko'];
  const seedOverride = flag('seeds')?.split(',').map((s) => s.trim()).filter(Boolean);
  const limit = Number(flag('limit') ?? 100);

  console.log(`\nkeyword source comparison`);
  console.log(`  mode      ${baselineOnly ? 'baseline (autocomplete only)' : LIVE ? 'LIVE — real data, spends credit' : 'SANDBOX — mock data, wiring check only'}`);
  console.log(`  languages ${langs.join(', ')}`);

  // Refuse to report numbers we know are an artifact of the network. Every
  // count below would be 0, and 0 here means "unreachable", not "no demand".
  if (!(await autocompleteReachable())) {
    console.error(`
${'━'.repeat(72)}
ABORTED — Google Autocomplete is unreachable from this machine.

  fetchAutocomplete() returns [] on any failure, so continuing would print a
  0% long tail for autocomplete and look like a devastating finding. It would
  only be a firewall.

  grove's remote/CI sandboxes block suggestqueries.google.com AND
  dataforseo.com. Run this locally (~/Downloads/grove) instead.
${'━'.repeat(72)}`);
    process.exit(2);
  }

  for (const lang of langs) {
    const seeds = seedOverride ?? DEFAULT_SEEDS[lang];
    console.log(`\n  seeds[${lang}]  ${seeds.join(' · ')}`);

    // Autocomplete via grove's real path, so this measures what the product
    // actually produces today — variants, filtering, intent and all.
    const ideas = await gatherKeywordDemand(seeds, { maxSeeds: 8, limit, lang });
    const auto: Candidate[] = ideas.map((i) => ({ keyword: i.keyword }));

    let dfs: Candidate[] | null = null;
    if (!baselineOnly) {
      // PER-SEED tolerance, not Promise.all. The first version rejected the
      // whole language when any one seed threw, which discarded results that
      // had already been fetched AND PAID FOR — a real run came back "2 tasks,
      // 26 results, $0.0271" while reporting nothing but the failure. Partial
      // data is the normal state while an account is being provisioned, and it
      // is exactly when you most want to see what DID come back.
      // lib/keywords/dataforseo.ts already works this way; this now matches it.
      const settled = await Promise.allSettled(
        seeds.map((s) => dfsKeywordSuggestions(s, lang, Math.ceil(limit / seeds.length))),
      );

      const seen = new Set<string>();
      const got: Candidate[] = [];
      const failures: string[] = [];
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          failures.push(`${seeds[i]}: ${String(r.reason?.message ?? r.reason).slice(0, 160)}`);
          return;
        }
        for (const c of r.value) {
          const k = c.keyword.toLowerCase().trim();
          if (seen.has(k)) continue;
          seen.add(k);
          got.push(c);
        }
      });

      if (failures.length) {
        console.log(`\n  ⚠ ${failures.length}/${seeds.length} seeds failed:`);
        for (const f of failures) console.log(`      ${f}`);
      }
      // null still means "nothing came back at all", so the report can keep
      // saying "no comparison" rather than drawing a chart from zero rows.
      if (got.length) {
        dfs = got;
        if (failures.length) {
          console.log(`    ${got.length} keywords DID come back from ` +
            `${seeds.length - failures.length}/${seeds.length} seeds — comparing on those.`);
        }
      } else {
        console.log(`    Autocomplete baseline below is still valid.`);
      }
    }

    report(lang, auto, dfs);
  }

  if (spentTasks) {
    const cost = spentTasks * DFS_TASK_COST + spentResults * DFS_RESULT_COST;
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`DataForSEO usage: ${spentTasks} tasks · ${spentResults} results`);
    console.log(`  this run        $${cost.toFixed(4)}${LIVE ? '' : '  (sandbox — not actually billed)'}`);
    // The number that decides the integration: monthly planning is one pass
    // per domain, so the run above IS the per-domain unit cost.
    console.log(`  × 50 domains/mo $${(cost * 50).toFixed(2)}`);
  }

  if (!baselineOnly && !LIVE) {
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`⚠ SANDBOX DATA IS MOCK. Nothing above is evidence about coverage.`);
    console.log(`  Re-run with GROVE_DFS_LIVE=1 for the real comparison.`);
    console.log('─'.repeat(72));
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
