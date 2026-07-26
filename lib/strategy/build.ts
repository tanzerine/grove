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
import { gatherKeywordDemand, formatDemandForPrompt } from './keywords';
import { monthlySlots } from '../plans';
import type { MonthlyReport } from './review';

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
};

export type BuildStrategyInput = {
  month: string;                    // "2026-06"
  postsPerWeek: number;
  profile: SiteProfile;
  interview?: InterviewAnswers | null;
  prevStrategy?: Strategy | null;
  prevReport?: MonthlyReport | null;
  progressMd?: string | null;       // rolling weekly log (agent_context.progress_md)
  alreadyCovered?: string[];        // topic_memory keywords — don't re-propose these
  llmTimeoutMs?: number;            // cap for the planning call (crons run on a 300s budget)
  // This month's plan allowance. The cadence sets the shape of the calendar,
  // this caps how much of it we actually plan — slots past the allowance would
  // only be deferred as over-quota. Omit (or null) to plan on cadence alone.
  monthlyQuota?: number | null;
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
 */
function digestReport(r: MonthlyReport): string {
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
    const scQueries = sc.topQueries.slice(0, 12)
      .map((q) => `"${q.query}" (${q.impressions} impr, pos ${q.position})`).join(', ');
    const winners = sc.nearWinners.slice(0, 8)
      .map((w) => `"${(w.key || '').replace(/^https?:\/\/[^/]+/, '')}" (${w.impressions} impr, pos ${w.position})`).join(', ');
    lines.push(
      `SEARCH CONSOLE (real Google data): ${sc.impressions} impressions, ${sc.clicks} clicks, avg position ${sc.avgPosition}, appearing for ${sc.queryCount} queries.`,
      `GSC QUERIES YOU ALREADY RANK FOR (cover/strengthen these — proven demand at real positions): ${scQueries || '(none)'}`,
      `NEAR-WINNERS — pages stuck on page 2 (pos 8-20) with real impressions. REFRESHING ONE INTO THE TOP 10 IS THE HIGHEST-ROI MOVE THIS MONTH. Dedicate slots to sharper/expanded angles on these exact topics: ${winners || '(none yet)'}`,
    );
  }

  return lines.join('\n');
}

export async function buildStrategy(input: BuildStrategyInput): Promise<Strategy> {
  const { month, postsPerWeek, profile, interview, prevStrategy, prevReport, progressMd, alreadyCovered } = input;
  // The cadence and the plan allowance set the size; the calendar sets the
  // ceiling. A plan built mid-month can only reach as far as the month still
  // goes, so it's pro-rated to the days left instead of promising articles that
  // could only be dated in the past (see schedule.slotsForRemainder).
  const monthlyPostCount = Math.min(
    monthlySlots(postsPerWeek, input.monthlyQuota),
    slotsForRemainder(postsPerWeek, month),
  );
  const isFirstMonth = !prevStrategy && !prevReport?.totals?.views;

  // VALIDATED DEMAND — pull real search phrases (free, via Google Autocomplete)
  // for the business's own products/industry/value props. This grounds the
  // plan in what people actually search, fixing the month-1 cold start where
  // the planner had only the profile to go on. Best-effort: [] on any failure.
  const seeds = [
    ...profile.business.products_services,
    profile.business.industry,
    ...profile.business.value_props,
  ].map((s) => (s ?? '').trim()).filter(Boolean);
  let demandBlock = '(none captured — plan from the business profile)';
  try {
    const demand = await gatherKeywordDemand(seeds, { maxSeeds: 4, limit: 36 });
    demandBlock = formatDemandForPrompt(demand);
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

  const user = `MONTH: ${month}
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

VALIDATED SEARCH DEMAND (real Google autocomplete phrases for this business — prioritize covering these and pull target_keyword from here):
${demandBlock}

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
      "target_keyword": "optional primary SEO keyword",
      "notes": "optional"
    }
  ],
  "direction": {
    "month": "one confident sentence: where this month is heading and the number it moves",
    "weeks": ["week 1 in one line", "week 2 ...", "week 3 ...", "week 4 ..."]
  },
  "notes": "1-2 sentences on what this month does differently than last (or 'first month' if none)."
}

publishing_plan should contain exactly ${monthlyPostCount} slots, distributed across pillars in proportion to each pillar's importance.`;

  const { text, model } = await strategyLlmCall({ system, user, maxTokens: 4500, timeoutMs: input.llmTimeoutMs });
  const parsed = extractJson<Strategy>(text);

  const strategy = normalizeStrategy(parsed, { month, source, maxSlots: monthlyPostCount, postsPerWeek });
  strategy.planned_by = model;
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
