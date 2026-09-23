/**
 * Strategy builder — the planner step of the agent loop.
 *
 * Input:
 *   - site profile        (what the business does, voice, audience)
 *   - interview answers   (owner intent, optional)
 *   - previous strategy   (carry-forward + "what changed")
 *   - previous-month aggregate report   (what worked / what didn't)
 *
 * Output: a single Strategy record that drives the next month of:
 *   - topic generation (publishing_plan feeds the topic refiner)
 *   - manager evaluation (goals + kpis + pillars are the rubric scope)
 *   - end-of-month review (kpis are measured against post_events)
 */
import { strategyLlmCall, extractJson } from '../llm';
import type { SiteProfile } from '../pipeline/site-profile';
import { interviewSummary, type InterviewAnswers } from './interview';
import { assignPublishDates, slotsForRemainder } from './schedule';
import { titleTokens } from '../related-posts';
import { gatherKeywordDemand } from './keywords';
import { searchSeeds, isBrandTerm, localizeSeeds } from './seeds';
import { buildCustomerProfile, icpSeeds, buyerIntentSeeds, icpIsUsable, formatIcpForPrompt, type CustomerProfile } from './icp';
import { gatherLabsDemand, keywordOverview, withSerpAuthority, serpSnapshot } from '../keywords/dataforseo';
import { gscResearchPlan, mergeRevealed, type GscResearchPlan } from '../keywords/gsc-seeds';
import { latestSnapshot } from '../search-console/sync';
import { selectKeywords, effectiveVolume, type ScoredKeyword } from '../keywords/opportunity';
import { buildClusters, formatClustersForPrompt, type KeywordCluster } from '../keywords/cluster';
import { slotVerdict, withSlotVerdict } from '../keywords/difficulty';
import { demandFloor, demandFacts, gateSlots, type DemandFact } from '../keywords/demand-floor';
import { recordCandidates, excludedKeywords, markRejected, candidatePool, mergePool } from './candidate-store';
import { screenClusters } from '../keywords/relevance';
import { monthlySlots } from '../plans';
import type { MonthlyReport } from './review';
import { language, strategyLanguageRule, type LangCode } from '../language';
import { planLanguageMatches } from './freshness';
import type { UiLocale } from '../i18n';

export { assignPublishDates };   // re-exported for back-compat

export type Goal = {
  id: string;          // short slug, e.g. "trial-signups"
  title: string;
  why: string;         // one sentence — why this goal matters this month
};

export type KPI = {
  id: string;
  goal_id: string;
  metric:
    | 'views'
    | 'unique_sessions'
    | 'median_dwell_sec'
    | 'scroll_completion_rate'
    | 'outbound_to_product_rate'
    | 'conversions'
    | 'organic_share'
    | 'newsletter_signups';
  target: number;
  note?: string;
};

export type Pillar = {
  id: string;
  title: string;       // "Design system tokens", "Founder lessons", etc.
  intent_mix: {
    editorial: number;      // 0..1, sums to 1 across the three
    contextual: number;
    conversion: number;
  };
  audience: string;
  promise: string;     // one-line value promise of the pillar
};

export type PostSlot = {
  id: string;
  pillar_id: string;
  goal_id: string;
  kpi_id: string;
  topic: string;
  intent: 'editorial' | 'contextual' | 'conversion';
  target_keyword?: string;
  /** The rest of the keyword cluster this slot targets — phrases the SAME
   *  article should also satisfy. A page ranks for its cluster, not for one
   *  phrase, so planning one keyword per article leaves most of the reachable
   *  demand on the table. See lib/keywords/cluster.ts. */
  secondary_keywords?: string[];
  notes?: string;
  publish_date?: string;   // ISO instant this slot is slated to publish (UTC; UI renders local)
};

/**
 * The owner-facing narrative: one line for the month, one per week. This is
 * what makes "where are we heading this month / this week / today" a firm,
 * plain-language answer on the dashboard (today is derived from the calendar).
 */
export type Direction = {
  month: string;       // "Turn our design-tokens authority into 20 trial signups."
  weeks: string[];     // 4-5 one-liners, one per week of the month
};

export type Strategy = {
  month: string;                    // "2026-06"
  source: 'inferred' | 'interview' | 'mixed' | 'revised';
  goals: Goal[];
  kpis: KPI[];
  pillars: Pillar[];
  publishing_plan: PostSlot[];
  direction?: Direction;
  notes: string;                    // "vs. last month, we're..."
  /**
   * Replicate model id that actually produced this plan.
   *
   * Persisted to strategies.planned_by. Exists so "is the strategy tier really
   * being used?" is a query rather than a code read — the answer was silently
   * "no" for every automated build until the budget bug in lib/llm was found.
   */
  planned_by?: string;
  /**
   * Why the strategy tier did not produce this plan, when it didn't.
   *
   * Persisted to strategies.fallback_reason (0043). `planned_by` says the
   * workhorse answered; this says why, which is the half that was only ever
   * written to console.error. Absent on a clean top-tier build.
   */
  fallback_reason?: string | null;
  /**
   * The customer this plan was built for (step 2 of the keyword strategy).
   *
   * Persisted to strategies.customer_profile so the dashboard can show the
   * reader the strategist actually planned for. Absent when inference failed
   * and the build fell back to the site profile's own description.
   */
  customer_profile?: CustomerProfile;
};

/**
 * Output ceiling for one plan.
 *
 * A whole month has to fit: goals, KPIs, pillars, the week-by-week direction,
 * and up to ~17 calendar slots each carrying a topic, keyword and notes. At the
 * old 4500 this simply did not — on 2026-08-01 every oveners.com build stopped
 * at ~10.4KB, mid-calendar, and the JSON that came back was unparseable for the
 * dullest possible reason: the model was still writing. The bigger domain (real
 * Search Console history to reason about, more slots to fill) hit the ceiling
 * that the smaller one cleared, which is why it looked domain-specific.
 *
 * Sized to fit the largest calendar the planner can be asked for with room for
 * prose, not to a round number. It is a ceiling, not a target — a short plan
 * costs nothing extra — and closeTruncatedJson still salvages the day if some
 * future plan outgrows even this.
 */
const PLAN_MAX_TOKENS = 9000;

export type BuildStrategyInput = {
  month: string;                    // "2026-06"
  postsPerWeek: number;
  profile: SiteProfile;
  interview?: InterviewAnswers | null;
  prevStrategy?: Strategy | null;
  prevReport?: MonthlyReport | null;
  progressMd?: string | null;       // rolling weekly log (agent_context.progress_md)
  alreadyCovered?: string[];        // topic_memory keywords — don't re-propose these
  /**
   * Wall clock left in THIS invocation for planning — the whole model ladder
   * plus write-back headroom, not a single call's cap. strategyLlmCall splits
   * it; see splitStrategyBudget for why handing out a per-call timeout instead
   * silently killed the function mid-fallback.
   */
  budgetMs?: number;
  // This month's plan allowance. The cadence sets the shape of the calendar,
  // this caps how much of it we actually plan — slots past the allowance would
  // only be deferred as over-quota. Omit (or null) to plan on cadence alone.
  monthlyQuota?: number | null;
  /** What the blog PUBLISHES in — pillar titles, slot titles and target
   *  keywords are handed to the writer verbatim, so they must be in it. */
  lang?: LangCode;
  /** Enables the keyword ledger (keyword_candidates, 0041): every phrase
   *  considered is recorded, and ones already planned or published are not
   *  proposed again. Omit and planning behaves exactly as it did before the
   *  table existed — the ledger is bookkeeping, never a dependency. */
  domainId?: string;
  /** What the OWNER reads grove in — goals, promises and notes are addressed
   *  to them and never published. Defaults to `lang` when omitted, which is
   *  the common case (a Korean blog run from a Korean dashboard). */
  uiLocale?: UiLocale;
};

/**
 * Turn a MonthlyReport into a compact, COMPLETE digest for the planner.
 *
 * The old code did `JSON.stringify(report).slice(0, 3500)`, which routinely cut
 * the JSON mid-object — the model received malformed data and ignored it. This
 * extracts the decision-relevant signal and never truncates a structure:
 *   - what won / lost by intent (so the intent mix can shift with evidence)
 *   - top & bottom posts with the metric that explains why
 *   - real search queries (the strongest demand signal we have)
 *
 * Exported for tests: the near-winner section is a behavioural guard (it decides
 * whether the planner competes with our own page-2 URLs), so its wording has to
 * be assertable rather than reviewed by eye.
 */
export function digestReport(r: MonthlyReport): string {
  const row = (p: any) =>
    `"${(p.title || p.post_id || '').slice(0, 60)}" — ${p.views} views, ${p.median_dwell_sec}s dwell, ${(p.scroll_100_rate * 100).toFixed(0)}% read-through, ${p.conversions} conv`;
  const intents = Object.entries(r.per_intent || {})
    .map(([k, v]: [string, any]) => `${k}: ${v.views} views / ${v.conversions} conv`)
    .join(' · ') || '(no intent data)';
  const queries = (r.top_queries || []).slice(0, 12)
    .map((q) => `"${q.query}" (${q.sessions})`).join(', ') || '(none captured)';

  const lines = [
    `MONTH ${r.month}: ${r.posts_count} posts, ${r.totals.views} views, ${r.totals.unique_sessions} sessions, ${(r.totals.organic_share * 100).toFixed(0)}% organic, ${r.totals.conversions} conversions.`,
    `BY INTENT: ${intents}`,
    `TOP POSTS (double down on these angles):`,
    ...(r.top_posts || []).slice(0, 5).map((p) => `  + ${row(p)}`),
    `BOTTOM POSTS (sharpen the angle or kill the pillar):`,
    ...(r.bottom_posts || []).slice(0, 5).map((p) => `  - ${row(p)}`),
    `REAL SEARCH QUERIES that brought readers (PRIORITIZE covering these — proven demand): ${queries}`,
  ];

  // Google Search Console — the strongest demand + opportunity signal we have,
  // and it exists even before traffic does (impressions at position 30 still count).
  const sc = r.search_console;
  if (sc && sc.impressions > 0) {
    // A query owned by a near-winner is withheld from the "cover these" list:
    // the two blocks would otherwise contradict each other on the same string,
    // one asking for a slot and the other forbidding it.
    const taken = new Set(
      sc.nearWinners.flatMap((w) => (w.queries ?? []).map((q) => q.query.toLowerCase())),
    );
    const scQueries = sc.topQueries
      .filter((q) => !taken.has(q.query.toLowerCase()))
      .slice(0, 12)
      .map((q) => `"${q.query}" (${q.impressions} impr, pos ${q.position})`).join(', ');
    const winners = sc.nearWinners.slice(0, 8)
      .map((w) => {
        const path = (w.key || '').replace(/^https?:\/\/[^/]+/, '');
        const owns = (w.queries ?? []).length
          ? ` — owns: ${w.queries.map((q) => `"${q.query}" (pos ${q.position})`).join(', ')}`
          : '';
        return `  - "${path}" (${w.impressions} impr, pos ${w.position})${owns}`;
      }).join('\n');
    lines.push(
      `SEARCH CONSOLE (real Google data): ${sc.impressions} impressions, ${sc.clicks} clicks, avg position ${sc.avgPosition}, appearing for ${sc.queryCount} queries.`,
      `GSC QUERIES YOU ALREADY RANK FOR (cover/strengthen these — proven demand at real positions): ${scQueries || '(none)'}`,
      `NEAR-WINNERS — our OWN pages already ranking at positions 8-20. They are the closest thing this domain has to a top-10 result, and they must not be competed with: a new article aimed at a query one of them already owns splits the signal between two of our own URLs and neither one gets there. Every query marked "owns" below is TAKEN — do not plan a slot for it, and do not plan a "sharper" or "expanded" retread of these pages.\n` +
      `What legitimately helps one of these: a slot that answers the NEXT question a reader has after reading it, targets a DIFFERENT query, and links back to it. That strengthens the near-winner instead of replacing it.\n` +
      `${winners || '  (none yet)'}`,
    );
  }

  return lines.join('\n');
}

export async function buildStrategy(input: BuildStrategyInput): Promise<Strategy> {
  const { month, postsPerWeek, profile, interview, prevStrategy, prevReport, progressMd, alreadyCovered, domainId } = input;
  // The cadence and the plan allowance set the size; the calendar sets the
  // ceiling. A plan built mid-month can only reach as far as the month still
  // goes, so it's pro-rated to the days left instead of promising articles that
  // could only be dated in the past (see schedule.slotsForRemainder).
  const monthlyPostCount = Math.min(
    monthlySlots(postsPerWeek, input.monthlyQuota),
    slotsForRemainder(postsPerWeek, month),
  );
  const isFirstMonth = !prevStrategy && !prevReport?.totals?.views;
  const pubLang = language(input.lang);
  const ownerLocale = input.uiLocale ?? pubLang.code;

  // VALIDATED DEMAND — pull real search phrases (free, via Google Autocomplete)
  // for the business's own products/industry/value props. This grounds the
  // plan in what people actually search, fixing the month-1 cold start where
  // the planner had only the profile to go on. Best-effort: [] on any failure.
  //
  // The seeds come from `searchSeeds`, NOT from the profile fields directly.
  // Those fields are marketing copy and autocomplete returns nothing for
  // marketing copy: measured on production profiles, every one of grove's own
  // seeds ("Autonomous AI blog writing", "Zero upkeep and no dashboards to
  // babysit", "AI Marketing Software / B2B SaaS") returned zero suggestions,
  // so this whole block silently produced "(none captured)" and the planner
  // fell back to inventing topics from the company's description of itself.
  // See lib/strategy/seeds.ts for the measurements.
  // The profile is written in English whatever the blog publishes in, so for a
  // non-English blog the seeds are localized first — otherwise the research is
  // real but aimed at the wrong market. No-ops (and costs nothing) for English.
  // Everything between here and the strategist's own call — the customer
  // profile, the DataForSEO fan-out, the ledger writes — is wall clock the
  // model ladder no longer has. It is subtracted below, the same way
  // ensureMonthlyStrategy subtracts its own DB work before handing the budget
  // down: the ladder's guarantee (it never overruns the function ceiling)
  // only holds if the number it is given is what is actually LEFT.
  const researchStartedAt = Date.now();

  // ── STEP 2: who the customer is ─────────────────────────────────────────
  // Before deciding what to write, decide who for. The site profile describes
  // the BUSINESS in the seller's words; nobody searches in the seller's words.
  // Fail-soft: an empty profile falls through to the old profile-derived seeds.
  const icp = await buildCustomerProfile(profile, pubLang.code);

  // ── STEP 3: seeds, from the CUSTOMER's vocabulary ───────────────────────
  // This is the fix for the defect seeds.ts measured: seeding research from
  // products_services/value_props meant seeding it from marketing copy, and
  // every one of grove's own seeds returned zero. Customer vocabulary is
  // already search-shaped because it is what someone types before they know a
  // product category exists. The profile-derived seeds remain the fallback,
  // not the default.
  const fromIcp = icpSeeds(icp, { limit: 8, brand: profile.business.name });
  if (!fromIcp.length) {
    // The degraded path. It is where the industry-label plans come from, and
    // it used to be taken in silence.
    console.warn(`[buildStrategy] no customer profile for ${profile.business.name} — seeding research from the site profile instead`);
  }
  const problemSeeds = await localizeSeeds(
    fromIcp.length ? fromIcp : searchSeeds(profile, { limit: 8 }),
    pubLang.code,
  );

  // ── STEP 3½: what Google already shows this domain for ──────────────────
  // The one list of searches known to be real, and the planner never read it
  // as a keyword source — only as a paragraph in the report. Measured on
  // oveners.com it held the site's best commercial impressions (competitor
  // names at position 6 with zero clicks, "make it by hand" queries) and the
  // database-only pipeline could not see any of them. See lib/keywords/gsc-seeds.
  // Already in the searcher's language, so never localized. Fail-soft: a
  // domain without Search Console plans exactly as before.
  let gsc: GscResearchPlan = { seeds: [], competitors: [], revealed: [], junk: 0 };
  if (domainId) {
    try {
      const snap = await latestSnapshot(domainId);
      gsc = gscResearchPlan(
        (snap.queries ?? []).map((r: any) => ({
          query: String(r.key ?? ''), impressions: Number(r.impressions ?? 0),
          clicks: Number(r.clicks ?? 0), position: Number(r.position ?? 0),
        })),
        {
          lang: pubLang.code,
          brand: profile.business.name,
          vocab: [...problemSeeds, ...(icp?.vocabulary ?? []), ...(profile.business.products_services ?? [])],
          days: 28,
        },
      );
      if (gsc.seeds.length || gsc.competitors.length || gsc.revealed.length) {
        console.log(`[buildStrategy] search console for ${profile.business.name}: ${gsc.seeds.length} seeds, ` +
          `${gsc.competitors.length} competitor queries (${gsc.competitors.join(', ') || '—'}), ` +
          `${gsc.revealed.length} revealed candidates, ${gsc.junk} junk rows`);
      }
    } catch (err) {
      console.warn(`[buildStrategy] search console read failed for ${profile.business.name}: ${String((err as any)?.message ?? err)}`);
    }
  }

  // ── STEP 3¾: the buyer's seeds ──────────────────────────────────────────
  // Competitor alternatives (Search Console's names first, the profile's
  // second), workarounds, use cases. These are what someone types when they
  // are already deciding; the problem seeds above are what they type before.
  // Order sets what survives the cap: real rankings, then real competitors,
  // then the customer's problem, then the model's guesses about the buyer.
  const buyerSeeds = buyerIntentSeeds(icp, {
    lang: pubLang.code, brand: profile.business.name, knownCompetitors: gsc.competitors, limit: 10,
  });
  const seeds = [...new Set([...gsc.seeds, ...buyerSeeds, ...problemSeeds])].slice(0, 24);

  // ── STEP 4: measured demand, and the selection it makes possible ────────
  let demandBlock = '(none captured — plan from the customer profile)';
  let clusterCount = 0;
  // What the slot gate after the planner call checks against. Stays empty —
  // and the gate stays off — unless demand was actually MEASURED: without
  // volume there is no floor to hold anyone to.
  let gatePool: ScoredKeyword[] = [];
  let gateClusters: KeywordCluster[] = [];
  try {
    // DataForSEO Labs carries volume AND difficulty; Autocomplete carries
    // neither and is a head-term service besides (four-word ceiling, measured
    // in seeds.ts), which biases its pool toward exactly the keywords a young
    // domain cannot win. So Labs is the source and Autocomplete is the floor —
    // NOT a peer. null from Labs means "never asked"; [] means "asked, nothing
    // there", and only the first should fall back.
    const labs = await gatherLabsDemand(seeds, pubLang.code, { perSeed: 150 });
    let scored: ScoredKeyword[];
    if (labs?.length) {
      scored = labs;
    } else {
      const auto = await gatherKeywordDemand(seeds, { maxSeeds: 8, limit: 36, lang: pubLang.code });
      scored = auto.map((a) => ({
        keyword: a.keyword, volume: null, difficulty: null, intent: a.intent, source: 'autocomplete',
      }));
    }

    // Revealed demand joins the pool with its impressions attached. Sized
    // through the provider where it can be — keywordOverview was written for
    // exactly this and had no caller — but a phrase the database has never
    // heard of keeps its impressions and scores on the domain's own position.
    // The floor and the score both read the effective figure, so "20/mo" no
    // longer deletes a phrase that showed this site 600 times last month.
    if (gsc.revealed.length) {
      const sized = labs?.length
        ? await keywordOverview(gsc.revealed.map((k) => k.keyword), pubLang.code)
        : null;
      scored = mergeRevealed(scored, gsc.revealed, sized ?? []);
    }

    // The brand's own name is not demand. It classifies as `informational`
    // (no navigational pattern matches a bare product name), so without this
    // it reaches the planner as a keyword to build pillars on — which is how a
    // blog ends up writing "What Is <Product>?" for an audience that has never
    // heard of it.
    scored = scored.filter((k) => !isBrandTerm(k.keyword, profile.business.name));

    // Write the ledger BEFORE selecting, so it records what was CONSIDERED and
    // not merely what won. A pool of winners cannot answer "what did we keep
    // passing over", which is half of why the table exists.
    if (domainId) await recordCandidates(domainId, scored, { lang: pubLang.code });

    // Everything the domain has already paid to measure joins this month's
    // research. The ledger was written to be read here and never was: a
    // 3,600/mo phrase measured in one month and not picked was gone the next
    // unless the API happened to return it again.
    if (domainId) scored = mergePool(scored, await candidatePool(domainId, pubLang.code));

    // Don't re-propose what is already planned or published — two of our own
    // pages splitting the signal for one query is cannibalisation, and it is
    // invisible without this record. Rejections expire (see shouldExclude), so
    // a keyword out of reach today comes back when the domain has grown into it.
    if (domainId) {
      const excluded = new Set((await excludedKeywords(domainId)).map((k) => k.toLowerCase()));
      if (excluded.size) scored = scored.filter((k) => !excluded.has(k.keyword.toLowerCase()));
    }

    // Grove's difficulty needs the top 10's domain authority, which fresh
    // Labs rows carry and ledger rows do not (the ledger stores only the
    // provider's KD). One batched call re-measures them, so a KD-0 trap
    // measured last month cannot re-enter this month on its old number.
    // See lib/keywords/difficulty.ts.
    if (labs?.length) scored = await withSerpAuthority(scored, pubLang.code);

    // Arithmetic, not vibes: rank by expected impressions and cut what is out
    // of reach. With Autocomplete-only input every candidate is unscorable, so
    // `chosen` is empty and the raw pool carries through — the planner then
    // sees phrases with "KD ?" rather than fabricated numbers.
    //
    // Wide on purpose: the relevance screen below runs on the clusters this
    // pool becomes, and a pool cut to the month's size BEFORE screening is a
    // pool the junk has already crowded — sixty phrases led by "blog the dog"
    // screen down to two. Select generously, screen, then take the best.
    const selection = selectKeywords(scored, { limit: 150 });
    const measured = selection.chosen.length > 0;
    const pool = measured ? selection.chosen : scored;

    // Dead space goes to the ledger with its reason, so the owner can see why
    // a big number was passed over and next month doesn't re-propose it
    // before the rejection expires.
    const dead = selection.rejected.filter((r) => r.reason === 'dead_space').map((r) => r.keyword);
    if (domainId && dead.length) await markRejected(domainId, dead, 'dead_space');

    // ── STEP 5: clusters ──────────────────────────────────────────────────
    // One cluster is one article. Twice the month's slots so the planner can
    // still balance intent across pillars rather than being handed a
    // pre-decided plan.
    // The long tail rides along as members only, and the floor moves to the
    // cluster's total: a 40/mo variant is not an article, but under a 900/mo
    // pillar it is thirty more readers a month for the same page. Unmeasured
    // pools get no floor — every total would be zero.
    // The floor is the article's: its whole cluster total, with the buyer-
    // query exception (lib/keywords/demand-floor.ts). Applied here rather
    // than as buildClusters' minTotalVolume because the exception reads the
    // pillar, and before the 80-cluster cut so a sub-floor cluster can't
    // take a place a real one needed.
    const built = buildClusters(pool, {
      membersOnly: measured ? selection.longTail : [],
    })
      .filter((c) => !measured || demandFloor(c.totalVolume, c.pillar.keyword) != null)
      .slice(0, 80);

    // ── STEP 4½: are these about the customer's problem at all? ──────────
    // Everything above is arithmetic on volume and difficulty, and arithmetic
    // handed grove's own blog "dog with the blog cast" (33,100/mo, KD 6) as
    // its best opportunity. One model call over the clusters, verdict per
    // cluster; the dropped ones are written to the ledger with the reason so
    // the owner can see why they were passed over and next month's build
    // doesn't propose them again. See lib/keywords/relevance.ts.
    const screened = await screenClusters(built, { business: profile.business, icp });
    if (domainId && screened.dropped.length) {
      await markRejected(
        domainId,
        screened.dropped.flatMap((d) => [d.cluster.pillar.keyword, ...d.cluster.members.map((m) => m.keyword)]),
        'off_topic',
      );
    }
    // Twice the month's slots so the planner can still balance intent across
    // pillars rather than being handed a pre-decided plan. buildClusters
    // sorted by score, so this keeps the best of what survived.
    let finalists = screened.kept;

    // ── STEP 4¾: who holds each seat, for the finalists ───────────────────
    // The averaged authority above can't see a SERP's SHAPE: three household
    // names on top and seven small sites below average out to "moderate",
    // and that SERP pays nothing to anyone under the top three. Labs keeps a
    // slot-by-slot snapshot with each result's domain rank; the few pillars
    // that might become articles are checked against it (well under a cent).
    if (measured && labs?.length && finalists.length) {
      const want = Math.min(finalists.length, Math.max(monthlyPostCount * 2, 12) + 6, 24);
      const head = finalists.slice(0, want);
      const snaps: (Awaited<ReturnType<typeof serpSnapshot>>)[] = [];
      for (let i = 0; i < head.length; i += 8) {
        snaps.push(...await Promise.all(head.slice(i, i + 8).map((c) => serpSnapshot(c.pillar.keyword, pubLang.code))));
      }
      const deadPillars: string[] = [];
      const deadLog: string[] = [];
      finalists = finalists.filter((c, i) => {
        const snap = i < snaps.length ? snaps[i] : null;
        if (!snap) return true;
        const v = slotVerdict(snap);
        if (!v.deadSpace) return true;
        if (c.pillar.assessment) c.pillar.assessment = withSlotVerdict(c.pillar.assessment, v);
        deadPillars.push(c.pillar.keyword);
        deadLog.push(`"${c.pillar.keyword}" (${v.reason})`);
        return false;
      });
      if (deadPillars.length) {
        console.log(`[buildStrategy] dead space for ${profile.business.name}: ${deadLog.join('; ')}`);
        if (domainId) await markRejected(domainId, deadPillars, 'dead_space');
      }
    }

    const clusters = finalists.slice(0, Math.max(monthlyPostCount * 2, 12));
    clusterCount = clusters.length;
    if (measured) {
      gatePool = scored;
      gateClusters = clusters;
    }
    demandBlock = formatClustersForPrompt(clusters);

    if (!scored.length) {
      // Loud: an empty demand list looked identical to a network failure for
      // months, and it was neither — it was unusable seeds.
      console.warn(`[buildStrategy] no search demand captured from seeds: ${seeds.join(', ') || '(none)'}`);
    } else if (selection.unscorable === scored.length) {
      // Not a failure, but the thing that keeps selection from being real: with
      // no volume and no difficulty there is nothing to rank on, so the plan is
      // chosen the way it was before any of this existed.
      //
      // The CAUSE is logged by lib/keywords/dataforseo.ts immediately above this
      // line — deliberately there rather than here, because only that module
      // knows whether the credentials were missing, refused, or unreachable, and
      // the first live run of this pipeline fell back with no way to tell which.
      console.warn(`[buildStrategy] ${scored.length} candidates carried no volume/difficulty; ` +
        `planning without keyword difficulty. See the [dataforseo] line above for why.`);
    }
  } catch { /* demand is best-effort signal */ }

  const source: Strategy['source'] = interview
    ? prevStrategy ? 'mixed' : 'interview'
    : 'inferred';

  const system = `You are the strategist agent for a small business blog.
Each month you produce a tight, measurable content plan that the rest of
the agent system executes against.

PRIORITIES (in order)
1. Serve the owner's stated goal — don't override their intent with your own.
2. Pick KPIs that are MEASURABLE in our analytics: views, unique sessions,
   median dwell seconds, scroll completion rate, outbound-to-product rate,
   conversions, organic share, newsletter signups. No vanity metrics.
3. Mix funnel intents across pillars. Conversion-heavy pillars need real
   product-relevance; editorial pillars build authority that conversion
   pillars later cash in. The actual slot intents you assign should roughly
   match the aggregate of your pillars' declared intent_mix.
4. If last month's report shows a clear winner, double down on it.
   If a pillar underperformed (low dwell / low read-through / low conv),
   propose either a sharper angle or kill it — say which, and why.
5. DEMAND FIRST: the report lists real search queries that already brought
   readers. Dedicate at least ~⅓ of the plan to covering those queries with a
   sharper angle than last time. Proven demand beats invented topics.
6. VALIDATED SEARCH DEMAND: a list of real phrases people search (from Google
   autocomplete) is provided. Build pillars and topics around these, and set
   each slot's "target_keyword" to a real phrase from the list when one fits.
   Match the phrase's search intent to the slot intent: informational →
   editorial/contextual, commercial → contextual/conversion, transactional →
   conversion. Don't force an unrelated keyword onto a slot.
7. SEARCH CONSOLE NEAR-WINNERS FIRST: if the report lists near-winners (pages
   on page 2 of Google with real impressions), dedicate your highest-priority
   slots to refreshing/expanding those exact topics with a sharper angle and
   set target_keyword to the query they already rank for. Moving an existing
   page from position 12 to 8 wins traffic faster than any brand-new post.

WRITE FOR THE READER'S PROBLEM, NOT ABOUT THE PRODUCT
The business name is not a keyword. Nobody searches for a product they have
not heard of, so an article built around the brand can only ever be found by
people who already know it — which is the audience the blog exists to grow,
not the one it already has. At most ONE slot per month may be about the
product itself (a launch, a genuine "how it works" piece). Every other slot
must target a problem the audience already has words for, and its
target_keyword must be a phrase a stranger would type. Specifically, do NOT
plan slots of the shape "What is <product>", "Why we built <product>",
"<product> vs <competitor>", "Inside <product>", "Your first week with
<product>" unless that one slot is the exception. This is not a style
preference: a blog that spent its first month on such titles recorded, over
the following 90 days, zero non-brand search queries.

TARGETS — REALISTIC BUT OPTIMISTIC
${isFirstMonth
  ? `This is the FIRST month (no traffic history). Set modest absolute KPI
targets a brand-new blog can genuinely hit (tens of reads, single-digit
conversions — organic search compounds over 2-3 months, it does not spike in
week one). Frame the month as building the foundation the next months cash
in. Never promise rankings or traffic volumes you have no evidence for.`
  : `Anchor every KPI target to LAST MONTH'S ACTUALS in the report and the
progress log below: target roughly 1.2-1.5x what was actually achieved, and
call out the growth explicitly in the direction narrative. A target below
last month's actual is sandbagging; more than ~2x without a clear causal
lever (near-winner refresh, proven query, new distribution) is fantasy.`}

DIRECTION — the owner-facing narrative. Also output a "direction" object:
one sentence for the month (specific, confident, grounded in the plan — the
owner should read it and know exactly where this month is heading) and one
short line per week of the month describing what that week ships and why it
comes in that order. Plain language, no marketing jargon, no hedging.

DON'T
- Don't invent metrics we can't measure.
- Don't promise more than ${monthlyPostCount} articles.
- Don't pick topics that violate the owner's off-limits list.
- Don't fabricate prior performance — only reference fields you actually see.
- Don't re-propose a topic in ALREADY COVERED — pick a fresh angle or a new keyword.
- ONE PAGE PER QUERY: every slot must target a DISTINCT primary keyword. No two
  slots may chase the same query or near-synonyms of it ("free AI icon
  generator" vs "AI icon generator free" is the SAME query) — overlapping posts
  cannibalize each other in Google and split what one strong page would earn.

OUTPUT: ONE raw JSON object. No markdown. No prose. No code fences.`;

  // The language command goes FIRST in the user prompt — the lesson from the
  // article pipeline, where the same instruction at the tail of a system prompt
  // was ignored by all three models.
  const langRule = strategyLanguageRule(pubLang.code, ownerLocale);

  // A PLAN THAT DRIFTED STAYS DRIFTED, because last month's pillar titles go
  // into this prompt for continuity and the model reads them as the house
  // style. www.oveners.com is the case: `language` is 'en', so
  // strategyLanguageRule returns the EMPTY STRING — nothing in the prompt ever
  // says "English" — and a plan that came back Korean once seeds the next one
  // with Korean pillars and no instruction to the contrary. Three months of
  // English articles became eleven Korean ones that way, with the column
  // unchanged throughout.
  //
  // So when the previous plan is confidently not in the publication language,
  // say so out loud, English included. This costs nothing in the common case:
  // planLanguageMatches abstains unless it is certain (see freshness.ts), so a
  // plan that is merely short, or Latin-script either way, never trips it.
  const drifted = !!prevStrategy && !planLanguageMatches(prevStrategy, pubLang.code);
  const driftRule = drifted
    ? `!! THE PLAN BELOW UNDER "LAST MONTH'S STRATEGY" IS IN THE WRONG LANGUAGE !!
This blog publishes in ${pubLang.englishName} (${pubLang.nativeName}). Last month's plan
is not, and it is shown only for continuity of STRATEGY — the topics it covered
and how they performed. Do not copy its language. Every string a reader will
see — pillar titles, slot titles, target keywords — must be in ${pubLang.nativeName}.`
    : '';

  const user = `${[driftRule, langRule].filter(Boolean).join('\n\n')}${driftRule || langRule ? '\n\n' : ''}MONTH: ${month}
POSTS THIS MONTH (target): ${monthlyPostCount}

BUSINESS
Name: ${profile.business.name}
Industry: ${profile.business.industry}
What they do: ${profile.business.description}
Products / services: ${profile.business.products_services.join(', ') || 'unknown'}
Target audience (inferred): ${profile.business.target_audience}
Value props: ${profile.business.value_props.join('; ') || 'unknown'}

OWNER INTERVIEW (highest authority — overrides inferred values when present):
${interviewSummary(interview ?? null)}

LAST MONTH'S STRATEGY (for continuity / contrast):
${prevStrategy ? JSON.stringify({ goals: prevStrategy.goals, kpis: prevStrategy.kpis, pillars: prevStrategy.pillars.map((p) => p.title) }) : '(none — first month)'}

LAST MONTH'S REPORT (real numbers from analytics):
${prevReport ? digestReport(prevReport) : '(none — first month)'}

PROGRESS LOG (weekly entries, newest last — the season so far):
${progressMd?.trim() ? progressMd.trim().slice(-4000) : '(no weekly history yet)'}

WHO YOU ARE WRITING FOR (inferred customer profile — plan for this person, not for the company):
${formatIcpForPrompt(icp)}

MEASURED DEMAND — keyword clusters, best opportunity first.
ONE CLUSTER IS ONE ARTICLE. Target the pillar keyword; satisfy the "also covers"
phrases in the same piece. KD is 0-100 ranking difficulty (lower is winnable);
"cluster total" is the monthly searches that one article can reach, which is the
number worth planning against — not the pillar's own volume.
${demandBlock}${clusterCount ? `

CLUSTER RULE: every slot's "target_keyword" MUST be one of the cluster pillars
above, used at most once across the whole plan, and its "secondary_keywords"
MUST be that cluster's "also covers" phrases. Do not invent keywords while
clusters are listed — they were selected on real volume and difficulty, and an
invented one has neither. Choose WHICH clusters to run and in what order; that
is the judgement being asked of you.
SKIP a cluster whose phrase is about something else — a show, a film, a
recipe, a game, a job listing, a trivia query — however large its volume. A
phrase searched by people who will never need this business is not demand for
it, and an article bent to fit one is an article nobody who matters reads.
If fewer relevant clusters remain than slots, plan FEWER slots.` : ''}

TOPIC RULE: at most ONE slot this month may be about ${profile.business.name} itself. Every other slot targets a problem the audience searches for, with a target_keyword a stranger would actually type. "${profile.business.name}" is not a keyword.

ALREADY COVERED (don't repeat these topics/keywords):
${alreadyCovered?.length ? alreadyCovered.slice(0, 60).join(', ') : '(nothing on file)'}

Produce the new strategy as JSON:
{
  "month": "${month}",
  "source": "${source}",
  "goals": [
    { "id": "slug", "title": "...", "why": "..." }
  ],
  "kpis": [
    { "id": "slug", "goal_id": "matches a goal id", "metric": "one of the allowed enum", "target": 123, "note": "optional" }
  ],
  "pillars": [
    {
      "id": "slug",
      "title": "...",
      "intent_mix": { "editorial": 0.0, "contextual": 0.0, "conversion": 0.0 },
      "audience": "...",
      "promise": "..."
    }
  ],
  "publishing_plan": [
    {
      "id": "slug",
      "pillar_id": "matches a pillar id",
      "goal_id": "matches a goal id",
      "kpi_id": "matches a kpi id",
      "topic": "the specific article topic",
      "intent": "editorial | contextual | conversion",
      "target_keyword": "a cluster pillar from MEASURED DEMAND when any are listed",
      "secondary_keywords": ["that cluster's 'also covers' phrases"],
      "notes": "optional"
    }
  ],
  "direction": {
    "month": "one confident sentence: where this month is heading and the number it moves",
    "weeks": ["week 1 in one line", "week 2 ...", "week 3 ...", "week 4 ..."]
  },
  "notes": "1-2 sentences on what this month does differently than last (or 'first month' if none)."
}

publishing_plan should contain exactly ${monthlyPostCount} slots, distributed across pillars in proportion to each pillar's importance.${langRule ? `

WHICH LANGUAGE EACH FIELD TAKES
- ${pubLang.nativeName} (it becomes an article): pillars[].title, publishing_plan[].topic, publishing_plan[].target_keyword, publishing_plan[].secondary_keywords[]
- ${language(ownerLocale).nativeName} (the owner reads it): goals[].title, goals[].why, kpis[].note, pillars[].audience, pillars[].promise, publishing_plan[].notes, direction.month, direction.weeks[], notes
- unchanged: every id, every date, source, metric, intent, intent_mix

${langRule}` : ''}`;

  const { text, model, fallbackReason } = await strategyLlmCall({
    system, user, maxTokens: PLAN_MAX_TOKENS,
    budgetMs: input.budgetMs == null ? undefined : Math.max(0, input.budgetMs - (Date.now() - researchStartedAt)),
  });
  const parsed = extractJson<Strategy>(text);

  const strategy = normalizeStrategy(parsed, { month, source, maxSlots: monthlyPostCount, postsPerWeek });

  // ── The floor, on the plan itself ───────────────────────────────────────
  // The prompt says "target a cluster pillar"; until this gate nothing
  // checked, and 58% of slots came back with a keyword the model invented —
  // no volume by construction, which is how grove published 51 articles into
  // 570 impressions. Every slot is held to the same floor as the clusters.
  if (gateClusters.length && strategy.publishing_plan.length) {
    try {
      strategy.publishing_plan = await gatePlan(strategy.publishing_plan, gatePool, gateClusters, pubLang.code);
    } catch (err) {
      console.warn(`[buildStrategy] slot gate failed, plan kept as the model wrote it: ${String((err as any)?.message ?? err)}`);
    }
  }

  // A plan with no calendar is not a plan — it is a row that makes the month
  // read as COVERED while publishing nothing, which is worse than no row at
  // all because the hourly self-heal then skips the domain forever. Only
  // reachable if the model was cut off before the first slot; throwing hands
  // the domain back to the next tick, which is the recoverable outcome.
  if (monthlyPostCount > 0 && !strategy.publishing_plan.length) {
    throw new Error(
      `strategy for ${month} came back with no publishing_plan ` +
      `(expected ${monthlyPostCount} slots, model ${model}) — refusing to persist an empty month`,
    );
  }

  strategy.planned_by = model;
  strategy.fallback_reason = fallbackReason;
  if (icpIsUsable(icp)) strategy.customer_profile = icp;
  return strategy;
}

/**
 * Normalize + guardrail an LLM-produced strategy so we never persist dangling
 * references, invalid KPIs, or an undated calendar. Shared by the monthly
 * build and the plan-revision chat.
 */
export function normalizeStrategy(
  parsed: Strategy,
  opts: { month: string; source: Strategy['source']; maxSlots: number; postsPerWeek: number },
): Strategy {
  const { month, source, maxSlots, postsPerWeek } = opts;

  parsed.month = month;
  parsed.source = source;
  parsed.goals = (parsed.goals ?? []).slice(0, 4);
  parsed.kpis = (parsed.kpis ?? []).filter(validKpi);
  parsed.pillars = (parsed.pillars ?? []).slice(0, 5).map(normalizePillar);
  parsed.publishing_plan = (parsed.publishing_plan ?? []).slice(0, maxSlots);
  parsed.direction = normalizeDirection(parsed);

  // Backfill links so we never ship dangling references.
  const goalIds = new Set(parsed.goals.map((g) => g.id));
  const pillarIds = new Set(parsed.pillars.map((p) => p.id));
  const kpiIds = new Set(parsed.kpis.map((k) => k.id));

  parsed.publishing_plan = parsed.publishing_plan.map((slot, i) => ({
    ...slot,
    id: slot.id || `slot-${i + 1}`,
    pillar_id: pillarIds.has(slot.pillar_id) ? slot.pillar_id : parsed.pillars[0]?.id ?? 'pillar-1',
    goal_id: goalIds.has(slot.goal_id) ? slot.goal_id : parsed.goals[0]?.id ?? 'goal-1',
    kpi_id: kpiIds.has(slot.kpi_id) ? slot.kpi_id : parsed.kpis[0]?.id ?? 'kpi-1',
    intent: ['editorial', 'contextual', 'conversion'].includes(slot.intent) ? slot.intent : 'contextual',
    // The model is asked for the cluster's other phrases; it may return a
    // string, nulls, or forty of them. Capped at the cluster ceiling so a
    // runaway list cannot turn one article into an unfocused sweep.
    secondary_keywords: Array.isArray((slot as any).secondary_keywords)
      ? (slot as any).secondary_keywords
          .map((k: unknown) => (typeof k === 'string' ? k.trim() : ''))
          .filter(Boolean)
          .slice(0, 8)
      : undefined,
  }));

  // Drop within-plan duplicates BEFORE dates are assigned — the prompt forbids
  // them, but the July plan still shipped three "free AI 3D icon generator"
  // posts in one month, which cannibalize each other in Google.
  parsed.publishing_plan = dedupeSlots(parsed.publishing_plan);

  // Deterministically assign each slot a real publish date so the calendar has
  // a concrete schedule (the LLM is bad at evenly spacing dates; code isn't).
  parsed.publishing_plan = assignPublishDates(parsed.publishing_plan, month, postsPerWeek);

  return parsed;
}

/**
 * Measure whatever the planner targeted outside the pool, then gate every
 * slot on the demand floor. The measurement is one keyword_overview call for
 * the invented keywords only — so an invented phrase that turns out to have
 * real demand is kept on its merits, and one Labs has never heard of fails
 * as `unmeasured` (the buyer-query exception aside).
 */
async function gatePlan(
  slots: PostSlot[],
  pool: ScoredKeyword[],
  clusters: KeywordCluster[],
  lang: LangCode,
): Promise<PostSlot[]> {
  const facts = demandFacts(pool, clusters, effectiveVolume);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const invented = slots
    .map((s) => (s.target_keyword ?? '').trim())
    .filter((k) => k && !facts.has(norm(k)));
  if (invented.length) {
    const sized = (await keywordOverview(invented, lang)) ?? [];
    for (const k of sized) {
      facts.set(norm(k.keyword), {
        keyword: k.keyword, total: effectiveVolume(k), deadSpace: !!k.assessment?.deadSpace, members: [],
      });
    }
  }
  const spare: DemandFact[] = clusters.map((c) => facts.get(norm(c.pillar.keyword))!).filter(Boolean);
  const { slots: gated, changes } = gateSlots(slots, facts, spare);
  if (changes.length) console.log(`[buildStrategy] slot gate: ${changes.join('; ')}`);
  return gated;
}

/**
 * Keep the first slot per query; drop later slots that target the same
 * normalized keyword or whose topic tokens are ≥80% contained in an earlier
 * slot's (catches "AI icon generator free" vs "free AI icon generator: what
 * you actually get"). Fewer, distinct posts beat a cluster of near-twins.
 */
export function dedupeSlots<T extends { topic?: string; target_keyword?: string }>(slots: T[]): T[] {
  const kept: T[] = [];
  const keywords = new Set<string>();
  const tokenSets: Set<string>[] = [];
  for (const s of slots) {
    const kw = (s.target_keyword ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (kw && keywords.has(kw)) continue;
    const toks = titleTokens(s.topic ?? '');
    const nearDup = toks.size >= 3 && tokenSets.some((prev) => {
      if (prev.size < 3) return false;
      let common = 0;
      for (const t of toks) if (prev.has(t)) common++;
      return common / Math.min(prev.size, toks.size) >= 0.8;
    });
    if (nearDup) continue;
    if (kw) keywords.add(kw);
    tokenSets.push(toks);
    kept.push(s);
  }
  return kept;
}

/** Direction is optional in the raw output — synthesize a fallback from the
 *  goals so the dashboard's month/week/today answer is never blank. */
function normalizeDirection(s: Strategy): Direction {
  const d = s.direction;
  const month = (typeof d?.month === 'string' && d.month.trim())
    ? d.month.trim()
    : (s.goals?.[0] ? `${s.goals[0].title} — ${s.goals[0].why}` : `Ship ${s.publishing_plan?.length ?? 0} posts this month`);
  const weeks = Array.isArray(d?.weeks)
    ? d!.weeks.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()).slice(0, 5)
    : [];
  return { month, weeks };
}

export function validKpi(k: KPI): boolean {
  const allowed: KPI['metric'][] = [
    'views', 'unique_sessions', 'median_dwell_sec',
    'scroll_completion_rate', 'outbound_to_product_rate',
    'conversions', 'organic_share', 'newsletter_signups',
  ];
  return !!k && allowed.includes(k.metric) && typeof k.target === 'number' && k.target > 0;
}

export function normalizePillar(p: Pillar): Pillar {
  // Force intent_mix to sum to 1; fall back to a sane default.
  const mix = p.intent_mix ?? { editorial: 0.3, contextual: 0.5, conversion: 0.2 };
  const sum = (mix.editorial ?? 0) + (mix.contextual ?? 0) + (mix.conversion ?? 0);
  const normalized = sum > 0
    ? {
        editorial: (mix.editorial ?? 0) / sum,
        contextual: (mix.contextual ?? 0) / sum,
        conversion: (mix.conversion ?? 0) / sum,
      }
    : { editorial: 0.3, contextual: 0.5, conversion: 0.2 };
  return { ...p, intent_mix: normalized };
}
