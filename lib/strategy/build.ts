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
import { llmCall, extractJson } from '../llm';
import type { SiteProfile } from '../pipeline/site-profile';
import { interviewSummary, type InterviewAnswers } from './interview';
import { assignPublishDates } from './schedule';
import { gatherKeywordDemand, formatDemandForPrompt } from './keywords';
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

export type Strategy = {
  month: string;                    // "2026-06"
  source: 'inferred' | 'interview' | 'mixed';
  goals: Goal[];
  kpis: KPI[];
  pillars: Pillar[];
  publishing_plan: PostSlot[];
  notes: string;                    // "vs. last month, we're..."
};

export type BuildStrategyInput = {
  month: string;                    // "2026-06"
  postsPerWeek: number;
  profile: SiteProfile;
  interview?: InterviewAnswers | null;
  prevStrategy?: Strategy | null;
  prevReport?: MonthlyReport | null;
  alreadyCovered?: string[];        // topic_memory keywords — don't re-propose these
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

  return [
    `MONTH ${r.month}: ${r.posts_count} posts, ${r.totals.views} views, ${r.totals.unique_sessions} sessions, ${(r.totals.organic_share * 100).toFixed(0)}% organic, ${r.totals.conversions} conversions.`,
    `BY INTENT: ${intents}`,
    `TOP POSTS (double down on these angles):`,
    ...(r.top_posts || []).slice(0, 5).map((p) => `  + ${row(p)}`),
    `BOTTOM POSTS (sharpen the angle or kill the pillar):`,
    ...(r.bottom_posts || []).slice(0, 5).map((p) => `  - ${row(p)}`),
    `REAL SEARCH QUERIES that brought readers (PRIORITIZE covering these — proven demand): ${queries}`,
  ].join('\n');
}

export async function buildStrategy(input: BuildStrategyInput): Promise<Strategy> {
  const { month, postsPerWeek, profile, interview, prevStrategy, prevReport, alreadyCovered } = input;
  const monthlyPostCount = Math.max(4, Math.round(postsPerWeek * 4.3));

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

DON'T
- Don't invent metrics we can't measure.
- Don't promise more than ${monthlyPostCount} articles.
- Don't pick topics that violate the owner's off-limits list.
- Don't fabricate prior performance — only reference fields you actually see.
- Don't re-propose a topic in ALREADY COVERED — pick a fresh angle or a new keyword.

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
  "notes": "1-2 sentences on what this month does differently than last (or 'first month' if none)."
}

publishing_plan should contain exactly ${monthlyPostCount} slots, distributed across pillars in proportion to each pillar's importance.`;

  const { text } = await llmCall({ system, user, json: true, maxTokens: 4500 });
  const parsed = extractJson<Strategy>(text);

  // ── normalize + guardrails ─────────────────────────────────
  parsed.month = month;
  parsed.source = source;
  parsed.goals = (parsed.goals ?? []).slice(0, 4);
  parsed.kpis = (parsed.kpis ?? []).filter(validKpi);
  parsed.pillars = (parsed.pillars ?? []).slice(0, 5).map(normalizePillar);
  parsed.publishing_plan = (parsed.publishing_plan ?? []).slice(0, monthlyPostCount);

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

  // Deterministically assign each slot a real publish date so the calendar has
  // a concrete schedule (the LLM is bad at evenly spacing dates; code isn't).
  parsed.publishing_plan = assignPublishDates(parsed.publishing_plan, month, postsPerWeek);

  return parsed;
}

function validKpi(k: KPI): boolean {
  const allowed: KPI['metric'][] = [
    'views', 'unique_sessions', 'median_dwell_sec',
    'scroll_completion_rate', 'outbound_to_product_rate',
    'conversions', 'organic_share', 'newsletter_signups',
  ];
  return !!k && allowed.includes(k.metric) && typeof k.target === 'number' && k.target > 0;
}

function normalizePillar(p: Pillar): Pillar {
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
