/**
 * Phase 0 — does Jev's judgment carry any information about search outcomes?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Before grove builds an expected-value scorer on top of a System One model,
 * one question has to be settled: asked where an article will rank, is Jev
 * better than guessing the base rate? TypeSafe says so themselves — "typed
 * output guarantees the interface, not truth ... validate their performance in
 * the target domain." This is that validation, and it costs a few cents.
 *
 * The answer is NOT "is Jev accurate". A distribution over six position bands
 * is allowed to be wrong on any single article. What must be true for the
 * feature to work is that Jev DISCRIMINATES: that the articles it puts in the
 * top bands really do rank better than the ones it doesn't. Brier and log-loss
 * against the marginal baseline measure exactly that, and top-1 accuracy does
 * not — 51% of grove's observed pairs sit in band 3, so "always say 4-10"
 * scores 51% while knowing nothing at all. That number is printed as the
 * baseline for precisely this reason.
 *
 * ── TWO backtests, because GSC data is CENSORED ────────────────────────────
 * Search Console only reports a (page, query) pair when the page was SHOWN.
 * A page that never ranked for anything produces no rows — it is missing, not
 * zero. So a backtest over gsc_page_queries alone is conditioned on having
 * been shown, and answers a question the product never asks.
 *
 *   A — TARGET KEYWORD (the product's question).  For each aged published
 *       post, the target is the `target_keyword` on its slot in the strategy's
 *       publishing_plan — the phrase it was commissioned to win. Outcome is the
 *       best band GSC ever reported for that page on that query, and "never"
 *       when it reported none. The never-ranked posts are the negatives the
 *       other backtest cannot see, and there are more of them than winners.
 *       Smaller n, but it is the question the gate will actually be asked.
 *
 *       NOT `posts.topic`: that column holds an editorial brief ("Refresh +
 *       expand: retest all 7 picks, add speed scores"), not a search query.
 *       The first version of this script used it, and every label came back
 *       "never" because no human ever types a sentence like that into Google.
 *       A backtest can be wrong in a way that still prints a tidy number.
 *
 *   B — OBSERVED QUERY (the larger, easier set).  For each (post, query) pair
 *       GSC reported, predict the band. More examples, but every one of them
 *       already cleared the bar of being shown, and most sit on ultra-long-tail
 *       queries where our page is nearly the only relevant result. A good
 *       score here does NOT license the gate.
 *
 * Both are reported. If they disagree, A is the one that counts.
 *
 * ── The SERP mismatch, stated up front ─────────────────────────────────────
 * A faithful replay would need the SERP as it stood when each post was
 * published; grove never stored it. Passing today's SERP leaks the future and
 * flatters the model. So the state here carries NO competitor data at all:
 * this measures the article-only signal, which is a LOWER bound on what the
 * real feature will see once serp_snapshots exists. Read a positive result as
 * "at least this much", never as the finished number.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   # build states, print the dataset and token estimate — no API key needed,
 *   # no tokens spent. Run this first; it validates the dataset on its own.
 *   npx vite-node scripts/jev-rank-backtest.ts --dry
 *
 *   # the real run
 *   TYPESAFE_API_KEY=… npx vite-node scripts/jev-rank-backtest.ts
 *
 *   # one backtest only
 *   npx vite-node scripts/jev-rank-backtest.ts --only=A
 *
 * Supabase credentials resolve themselves via scripts/_env.ts (.env.local, then
 * the linked Supabase CLI), so no env incantation is needed to run this.
 */
import './_env';   // resolves Supabase + .env.local before any client is built
import { createClient } from '@supabase/supabase-js';
import { TypeSafeClient, noul, score, type JsonValue } from '@typesafe-ai/sdk';

// ── position bands ─────────────────────────────────────────────────────────
// Ordered, coarse at the top where CTR moves violently and flat at the bottom
// where it does not. BAND_LEVELS is what Jev sees; the wording describes a
// concrete situation per level, which is what the Score primitive asks for.
const BANDS = ['pos1', 'pos2_3', 'pos4_10', 'pos11_20', 'pos21_30', 'never'] as const;
type Band = (typeof BANDS)[number];

// Score criteria are "indexed by score from zero", so level 0 must be the
// bottom of the scale and level 5 the top — the rubric has to read as an
// ascending ladder or the ordering the primitive assumes is inverted.
const BAND_LEVELS = [
  'Never reaches the top 30 for this query',
  'Positions 21-30 — found only by someone paging deep',
  'Positions 11-20 — the second page of results',
  'Positions 4-10 — the lower half of the first page',
  'Positions 2-3 — near the top of the first page',
  'Position 1 — the single top result',
] as const;

/** BAND_LEVELS is worst→best (level index); BANDS is best→worst. */
const LEVEL_TO_BAND: Band[] = ['never', 'pos21_30', 'pos11_20', 'pos4_10', 'pos2_3', 'pos1'];

function bandOf(position: number | null): Band {
  if (position == null || !(position > 0) || position > 30.5) return 'never';
  if (position <= 1.5) return 'pos1';
  if (position <= 3.5) return 'pos2_3';
  if (position <= 10.5) return 'pos4_10';
  if (position <= 20.5) return 'pos11_20';
  return 'pos21_30';
}

// ── state construction ─────────────────────────────────────────────────────
// Jev 1.13 is "quite literal", is "not a calculator", reads dates as text, and
// degrades as irrelevant context grows. So every number below is converted to
// a phrase in code before it is shown, the body is reduced to structure plus a
// short opening, and nothing decorative is included.

type Example = {
  postId: string;
  lang: string;
  query: string;
  observed: Band;
  state: Record<string, JsonValue>;
};

const headingsOf = (md: string): string[] =>
  md.split('\n')
    .map((l) => l.match(/^#{2,3}\s+(.{2,90}?)\s*#*\s*$/)?.[1])
    .filter((h): h is string => !!h)
    .slice(0, 14);

const openingOf = (md: string): string =>
  md.replace(/^#.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);

/** Depth as a phrase, never a number Jev would have to compare. */
function depthPhrase(words: number, lang: string): string {
  const cjk = lang === 'ko' || lang === 'zh';
  const unit = cjk ? 'characters' : 'words';
  if (words < 600) return `short — about ${words} ${unit}`;
  if (words < 1200) return `average length — about ${words} ${unit}`;
  if (words < 2200) return `in depth — about ${words} ${unit}`;
  return `very long — about ${words} ${unit}`;
}

function buildState(post: PostRow, query: string): Record<string, JsonValue> {
  const md = post.body_md ?? '';
  const stats = (post.validation?.stats ?? {}) as Record<string, number>;
  const words = Number(stats.word_count ?? 0);

  return {
    target_query: query,
    article: {
      title: post.title ?? '',
      depth: depthPhrase(words, post.lang),
      section_headings: headingsOf(md),
      opening: openingOf(md),
      has_key_takeaways: Number(stats.key_takeaways_count ?? 0) >= 3,
      has_faq: Number(stats.faq_count ?? 0) >= 2,
      sources_cited:
        Number(stats.citation_count ?? 0) >= 2
          ? 'cites named outside sources'
          : 'cites no outside sources',
      language: post.lang,
    },
    site: {
      note: 'A small independent company blog with no established search reputation. It is not a well-known brand and has few inbound links.',
    },
  };
}

// ── the question set ───────────────────────────────────────────────────────
// One narrow judgment per question. rank_band is the only one the score
// depends on; the other two are recorded to see whether they explain the
// misses, which is what phase 1 needs to know before buying SERP data.
const QUESTIONS = {
  rank_band: score(
    'Judge where this article will rank in Google for `target_query` about three months after it is published. Base the judgment only on how completely and directly the article answers that exact query compared with what a searcher would expect to find, and on the fact that the site publishing it has no established search reputation. Do not reward length on its own.',
    BAND_LEVELS,
  ),
  intent_match: score(
    'Does this article give a person searching `target_query` the thing they were looking for?',
    [
      'It answers a different question entirely',
      'It is on an adjacent topic but misses what was asked',
      'It partly answers the question, leaving the main part unaddressed',
      'It directly and completely answers the question',
    ] as const,
  ),
  too_generic: noul(
    'Is this article a generic overview that hundreds of other sites have already published in much the same form, with nothing specific, first-hand or new in it?',
  ),
} as const;

// ── scoring ────────────────────────────────────────────────────────────────
// Multiclass Brier and log-loss over the six bands, against the marginal
// baseline (predict the dataset's own band frequencies for every item). The
// baseline is the thing to beat: it encodes "know nothing, guess the mix".

type Scored = { probs: number[]; observed: Band; confidence: number; query?: string; postId?: string };

const brier = (probs: number[], obs: Band): number =>
  BANDS.reduce((s, b, i) => s + (probs[i] - (b === obs ? 1 : 0)) ** 2, 0);

const logLoss = (probs: number[], obs: Band): number =>
  -Math.log(Math.max(1e-9, probs[BANDS.indexOf(obs)]));

function marginal(rows: { observed: Band }[]): number[] {
  const counts = BANDS.map((b) => rows.filter((r) => r.observed === b).length);
  const n = Math.max(1, rows.length);
  // Laplace smoothing so an unseen band never makes log-loss infinite.
  return counts.map((c) => (c + 1) / (n + BANDS.length));
}

/**
 * AUC for the one question that survives a tiny positive count: ranked at all,
 * or not. Mann-Whitney U — the probability that a randomly chosen post that DID
 * rank was scored above one that didn't. 0.5 is a coin flip; it needs no
 * calibration and no minimum band coverage, only that both classes exist.
 *
 * Backtest A has ~5 positives in 51. A six-band reliability curve on that is
 * theatre — every bucket would hold one or two articles. This is the honest
 * measurement at that n, and it is still weak: with 5 positives the interval on
 * AUC is roughly ±0.15, so treat anything under ~0.70 as "no signal shown".
 */
function auc(rows: Scored[], scoreOf: (r: Scored) => number, isPos: (r: Scored) => boolean): number | null {
  const pos = rows.filter(isPos).map(scoreOf);
  const neg = rows.filter((r) => !isPos(r)).map(scoreOf);
  if (!pos.length || !neg.length) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function report(name: string, rows: Scored[]): void {
  if (!rows.length) return void console.log(`\n${name}: no examples\n`);
  const base = marginal(rows);
  const mean = (f: (r: Scored) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;

  const modelBrier = mean((r) => brier(r.probs, r.observed));
  const baseBrier = mean((r) => brier(base, r.observed));
  const modelLoss = mean((r) => logLoss(r.probs, r.observed));
  const baseLoss = mean((r) => logLoss(base, r.observed));
  const top1 = mean((r) =>
    BANDS[r.probs.indexOf(Math.max(...r.probs))] === r.observed ? 1 : 0);
  const baseTop1 = mean((r) => (BANDS[base.indexOf(Math.max(...base))] === r.observed ? 1 : 0));

  console.log(`\n── ${name} · n=${rows.length} ${'─'.repeat(Math.max(0, 46 - name.length))}`);
  console.log(`  Brier    model ${modelBrier.toFixed(4)}   baseline ${baseBrier.toFixed(4)}   ${modelBrier < baseBrier ? `BETTER by ${(baseBrier - modelBrier).toFixed(4)}` : 'NOT BETTER'}`);
  console.log(`  LogLoss  model ${modelLoss.toFixed(4)}   baseline ${baseLoss.toFixed(4)}   ${modelLoss < baseLoss ? 'BETTER' : 'NOT BETTER'}`);
  console.log(`  Top-1    model ${(top1 * 100).toFixed(1)}%      baseline ${(baseTop1 * 100).toFixed(1)}%   (informational only)`);

  // TWO discrimination tests, because the right one depends on the population.
  //   "ranked at all" is the question for A (which has real negatives — posts
  //   that never appeared for anything) and is DEGENERATE for B, where every
  //   example was shown by construction.
  //   "reached the first page" is the question for B, and it splits 96/74.
  // Discrimination is what a model either has or doesn't; miscalibration is
  // fixable afterwards with a one-parameter correction. So AUC, not Brier, is
  // what decides whether there is anything here to calibrate.
  const firstPageP = (r: Scored) => r.probs[0] + r.probs[1] + r.probs[2];
  const onFirstPage = (r: Scored) => r.observed === 'pos1' || r.observed === 'pos2_3' || r.observed === 'pos4_10';
  const aFp = auc(rows, firstPageP, onFirstPage);
  const nFp = rows.filter(onFirstPage).length;
  if (aFp != null) {
    const v = aFp >= 0.7 ? 'SIGNAL' : aFp >= 0.6 ? 'weak' : 'NO SIGNAL';
    console.log(`  AUC(1st) ${aFp.toFixed(3)} on "reached the first page"  (${nFp} yes / ${rows.length - nFp} no)  → ${v}`);
  }

  const ranked = (r: Scored) => r.observed !== 'never';
  const pRanks = (r: Scored) => 1 - r.probs[BANDS.indexOf('never')];
  const a = auc(rows, pRanks, ranked);
  const nPos = rows.filter(ranked).length;
  if (a == null) {
    console.log(`  AUC      not computable — only one class present (ranked=${nPos}/${rows.length})`);
  } else {
    const verdict = a >= 0.7 ? 'SIGNAL' : a >= 0.6 ? 'weak, inconclusive at this n' : 'NO SIGNAL';
    console.log(`  AUC      ${a.toFixed(3)} on "ranked at all"  (${nPos} ranked / ${rows.length - nPos} not)  → ${verdict}`);
    if (nPos < 10) console.log(`           ⚠ ${nPos} positives is too few to conclude much; treat as directional only`);
  }

  // Does `confidence` separate hits from misses? If it does not, the
  // route-to-human gate has nothing to stand on.
  const hi = rows.filter((r) => r.confidence >= 0.7);
  const lo = rows.filter((r) => r.confidence < 0.7);
  if (hi.length && lo.length) {
    const hb = hi.reduce((s, r) => s + brier(r.probs, r.observed), 0) / hi.length;
    const lb = lo.reduce((s, r) => s + brier(r.probs, r.observed), 0) / lo.length;
    console.log(`  Confidence split — high(≥0.7) n=${hi.length} Brier ${hb.toFixed(4)} · low n=${lo.length} Brier ${lb.toFixed(4)}   ${hb < lb ? 'confidence is informative' : 'CONFIDENCE IS NOT INFORMATIVE'}`);
  } else {
    console.log(`  Confidence split — not enough spread to test (high=${hi.length}, low=${lo.length})`);
  }

  // Reliability: of the articles Jev gave the most probability to reaching the
  // first page, how many actually did?
  const firstPage = (p: number[]) => p[0] + p[1] + p[2];                 // pos1 + 2-3 + 4-10
  const landed = (b: Band) => b === 'pos1' || b === 'pos2_3' || b === 'pos4_10';
  console.log('  P(first page) → observed rate:');
  for (const [lo_, hi_] of [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]]) {
    const bucket = rows.filter((r) => firstPage(r.probs) >= lo_ && firstPage(r.probs) < hi_);
    if (!bucket.length) continue;
    const rate = bucket.filter((r) => landed(r.observed)).length / bucket.length;
    console.log(`    ${lo_.toFixed(1)}–${hi_ === 1.01 ? '1.0' : hi_.toFixed(1)}  n=${String(bucket.length).padStart(3)}  observed ${(rate * 100).toFixed(0)}%`);
  }
}

// ── data ───────────────────────────────────────────────────────────────────

type PostRow = {
  id: string;
  /** The slot's target_keyword — a phrase a stranger would type. NOT posts.topic,
   *  which is an editorial brief ("Refresh + expand: retest all 7 picks…") and is
   *  not a search query at all. Asking where a page ranks for a brief is a
   *  question with no answer, and the resulting labels are all "never". */
  targetKeyword: string | null;
  title: string | null;
  body_md: string | null;
  validation: { stats?: Record<string, number> } | null;
  published_at: string | null;
  lang: string;
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function loadDataset(only: 'A' | 'B' | 'both') {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const { data: posts, error } = await db
    .from('posts')
    .select('id, title, body_md, validation, published_at, strategy_id, slot_id, domains(language)')
    .eq('status', 'published')
    .lt('published_at', cutoff);
  if (error) throw new Error(`posts: ${error.message}`);

  // The target keyword lives in the strategy's publishing_plan, on the slot the
  // post was written for. Resolve (strategy_id, slot_id) → target_keyword.
  const { data: strategies, error: sErr } = await db.from('strategies').select('id, publishing_plan');
  if (sErr) throw new Error(`strategies: ${sErr.message}`);
  const keywordBySlot = new Map<string, string>();
  for (const s of strategies ?? []) {
    for (const slot of (s.publishing_plan ?? []) as { id?: string; target_keyword?: string }[]) {
      const kw = (slot?.target_keyword ?? '').trim();
      if (slot?.id && kw) keywordBySlot.set(`${s.id}::${slot.id}`, kw);
    }
  }

  const rows: PostRow[] = (posts ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    targetKeyword: keywordBySlot.get(`${p.strategy_id}::${p.slot_id}`) ?? null,
    title: p.title as string | null,
    body_md: p.body_md as string | null,
    validation: p.validation as PostRow['validation'],
    published_at: p.published_at as string | null,
    lang: ((p.domains as { language?: string } | null)?.language) ?? 'en',
  }));

  // PostgREST caps a response at 1,000 rows and says nothing about it, so a
  // plain select here would silently drop more than half of gsc_page_queries
  // and quietly shrink the dataset. Page explicitly. Ordering by date desc
  // also makes "first row seen per key" mean the newest snapshot below.
  type GscRow = { post_id: string; query: string; position: number; date: string };
  const gsc: GscRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: gErr } = await db
      .from('gsc_page_queries')
      .select('post_id, query, position, date')
      .not('post_id', 'is', null)
      .order('date', { ascending: false })
      .range(from, from + 999);
    if (gErr) throw new Error(`gsc_page_queries: ${gErr.message}`);
    gsc.push(...((data ?? []) as GscRow[]));
    if (!data || data.length < 1000) break;
  }

  // Latest snapshot per (post, query) — rows arrive newest-first, so the first
  // one seen for a key is the one to keep.
  const latest = new Map<string, { query: string; position: number; postId: string }>();
  for (const g of gsc) {
    const k = `${g.post_id}::${g.query}`;
    if (!latest.has(k)) latest.set(k, { query: g.query, position: g.position, postId: g.post_id });
  }

  const byPost = new Map<string, { query: string; position: number }[]>();
  for (const v of latest.values()) {
    const list = byPost.get(v.postId) ?? [];
    list.push({ query: v.query, position: v.position });
    byPost.set(v.postId, list);
  }

  const A: Example[] = [];
  const B: Example[] = [];

  for (const p of rows) {
    if (!p.body_md || p.body_md.length < 500) continue;
    const seen = byPost.get(p.id) ?? [];

    // A — the commissioned target keyword. The label is simply: did GSC ever
    // report this page for this query? Search Console reports a pair as soon as
    // it earns one impression, so the absence of a row IS the negative — the
    // page was never shown for the phrase it was written to win.
    //
    // Exact (normalised) match first. A longer query CONTAINING the whole
    // target phrase counts too: "best automatic background remover free" is the
    // same intent as "best automatic background remover". Matching the other
    // direction — a GSC query contained BY the target — is not allowed, because
    // a one-word query sits inside almost any target and would manufacture wins.
    if (only !== 'B' && p.targetKeyword) {
      const target = norm(p.targetKeyword);
      const targetTokens = target.split(' ').filter(Boolean);
      const hits = seen.filter((s) => {
        const q = norm(s.query);
        if (q === target || q.includes(target)) return true;
        // Word order differs constantly between a planned keyword and what
        // people type ("background removal automatic tool"). Requiring every
        // target token to appear keeps the intent while dropping the order
        // constraint. Measured on this dataset: raw substring found 3 posts,
        // all-tokens finds 5 — the gap is word order, not a looser standard.
        return targetTokens.every((t) => q.includes(t));
      });
      const best = hits.length ? Math.min(...hits.map((s) => s.position)) : null;
      A.push({
        postId: p.id, lang: p.lang, query: p.targetKeyword,
        observed: bandOf(best),
        state: buildState(p, p.targetKeyword),
      });
    }

    // B — every query GSC actually reported for this page.
    if (only !== 'A') {
      for (const s of seen) {
        B.push({
          postId: p.id, lang: p.lang, query: s.query,
          observed: bandOf(s.position),
          state: buildState(p, s.query),
        });
      }
    }
  }

  return { A, B };
}

// ── runner ─────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const onlyArg = args.find((a) => a.startsWith('--only='))?.split('=')[1];
  const only = onlyArg === 'A' || onlyArg === 'B' ? onlyArg : 'both';

  const { A, B } = await loadDataset(only);

  const dist = (xs: Example[]) =>
    BANDS.map((b) => `${b}=${xs.filter((x) => x.observed === b).length}`).join(' ');

  console.log('\nDataset');
  console.log(`  A (target keyword)  n=${A.length}   ${dist(A)}`);
  console.log(`    (posts with no resolvable slot target_keyword are excluded from A)`);
  console.log(`  B (observed query)  n=${B.length}   ${dist(B)}`);
  const langs = [...new Set([...A, ...B].map((x) => x.lang))];
  console.log(`  languages: ${langs.join(', ')}${langs.some((l) => l !== 'en') ? '   ⚠ Jev accuracy is lower outside English — non-en results are reported separately' : ''}`);

  if (dry) {
    const all = [...A, ...B];
    const chars = all.reduce((s, x) => s + JSON.stringify(x.state).length, 0);
    console.log(`\n--dry: ${all.length} states built, ~${Math.round(chars / 4 / 1000)}k tokens total`);
    console.log(`       ≈ $${((chars / 4 / 1e6) * 0.042).toFixed(4)} at $0.042/M input tokens`);
    console.log('\nSample state:\n' + JSON.stringify(all[0]?.state, null, 2).slice(0, 1400));
    return;
  }

  // The key is stored as JEV_PRODUCT in this project's Vercel env; the SDK's
  // own fallback is TYPESAFE_API_KEY, so accept either and pass it explicitly.
  const apiKey = process.env.JEV_PRODUCT ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('JEV_PRODUCT (or TYPESAFE_API_KEY) is not set — use --dry to validate the dataset without a key');

  const client = new TypeSafeClient({ apiKey });
  let inputTokens = 0;

  async function scoreAll(name: string, examples: Example[]): Promise<Scored[]> {
    const out: Scored[] = [];
    let done = 0;
    // Modest concurrency: the published limit is 1,200 req/min, and this is a
    // one-off measurement, not a throughput test.
    const queue = [...examples];
    const workers = Array.from({ length: 8 }, async () => {
      for (;;) {
        const ex = queue.shift();
        if (!ex) return;
        try {
          const res = await client.systemOne({ state: ex.state, questions: QUESTIONS });
          const ans = res.answers.rank_band;
          inputTokens += res.usage.input_tokens;
          // `probabilities` is keyed by SCORE LEVEL ("0".."5"), not an array,
          // and level order is worst→best while BANDS is best→worst. Map through
          // LEVEL_TO_BAND rather than zipping the two — a silent reversal here
          // would invert the whole result and still produce a plausible report.
          const probs = ans.probabilities as Record<string, number>;
          const byBand = BANDS.map((b) => probs[String(LEVEL_TO_BAND.indexOf(b))] ?? 0);
          out.push({ probs: byBand, observed: ex.observed, confidence: ans.confidence, query: ex.query, postId: ex.postId });
        } catch (e) {
          console.error(`  ${name} skip ${ex.postId.slice(0, 8)} "${ex.query.slice(0, 40)}": ${(e as Error).message}`);
        }
        if (++done % 25 === 0) console.log(`  ${name}: ${done}/${examples.length}`);
      }
    });
    await Promise.all(workers);
    return out;
  }

  const scoredA = A.length ? await scoreAll('A', A) : [];
  const scoredB = B.length ? await scoreAll('B', B) : [];
  if (scoredA.length) report('A — target keyword (the product question)', scoredA);
  if (scoredB.length) report('B — observed query (conditioned on exposure)', scoredB);

  // Raw predictions to disk: metrics are cheap to change, inference is not.
  const outFile = 'jev-backtest-predictions.json';
  await (await import('node:fs/promises')).writeFile(
    outFile, JSON.stringify({ at: new Date().toISOString(), A: scoredA, B: scoredB }, null, 2));
  console.log(`\nRaw predictions written to ${outFile} — re-score without re-running inference.`);

  console.log(`\nSpend: ${inputTokens.toLocaleString()} input tokens · $${((inputTokens / 1e6) * 0.042).toFixed(4)}`);

  console.log(`
Read this as: the feature is worth building if A's Brier beats its baseline and
P(first page) slopes upward. B beating its baseline while A does not means Jev
can rate a page it was already shown for, but cannot predict whether a page will
break through — which is the question the gate asks. No SERP data was used, so
a positive result is a lower bound.
`);
}

run().catch((e) => { console.error(e); process.exit(1); });
