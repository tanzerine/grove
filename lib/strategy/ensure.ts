/**
 * ensureMonthlyStrategy — build + persist the current month's strategy for one
 * domain, if an active one doesn't already exist.
 *
 * Callers:
 *   - /api/cron/strategy — hourly, ONE domain per invocation with the whole
 *     function to itself. That isolation is the point: planning needs ~3-4
 *     uninterrupted minutes, and every earlier caller squeezed it into a slice
 *     of a shared tick, which silently demoted it to the workhorse model.
 *   - the onboarding/interview paths, where a human is waiting on a plan.
 *
 * Because the hourly route rebuilds anything missing for the current month, it
 * is also the self-heal: a month that starts with a failed build recovers
 * within the hour rather than staying dead until the 1st of the next one.
 *
 * Idempotent: an existing active strategy for (domain, current month) short-
 * circuits to 'exists'. Safe to call every tick.
 */
import { supabaseAdmin } from '../supabase/admin';
import { buildStrategy, type Strategy } from './build';
import { summarizeMonth } from './review';
import { parseInterview } from './interview';
import { getAgentContext, savePlanContext } from './context-store';
import { getQuota } from '../quota';
import { blankProfile, type SiteProfile } from '../pipeline/site-profile';
import { captureServer } from '../analytics/capture-server';

export type EnsureResult = 'created' | 'exists' | 'no_profile';

export type EnsureOptions = {
  /**
   * Wall clock this whole call may use — normally the route's `maxDuration`.
   *
   * Passed as the INVOCATION budget, not an LLM cap: the DB work below (the
   * month summary alone is an aggregate over post_events) runs before any model
   * is called, and time it spends is time the ladder no longer has. Measuring
   * it and handing the remainder down is what keeps the total inside the
   * function ceiling — see splitStrategyBudget.
   */
  budgetMs?: number;
  /**
   * Plan even with no usable site profile, from a hostname-only one.
   *
   * The crawl can fail for reasons the customer can't fix (Cloudflare, a
   * provider blip, a site that isn't up yet), and treating that as "no plan"
   * cost them the whole month. Set by the paths where a human is waiting on a
   * plan and has just told us their intent — which is the better input anyway.
   */
  profileFallback?: boolean;
  /**
   * Rebuild over this month's active strategy instead of short-circuiting on
   * it. Set when the owner has just changed what they want: the latest intent
   * wins, and the crons keep their idempotent default.
   */
  replaceActive?: boolean;
  /**
   * The month to plan for. Defaults to the current one.
   *
   * Set by the lookahead path in /api/cron/strategy so next month's plan can be
   * built during this one — see lib/strategy/rollover for why the boundary was
   * a platform-wide outage without it.
   */
  month?: Date;
  /**
   * Store the plan INACTIVE, and leave the live plan alone.
   *
   * Set when planning a month that hasn't started. An active row would win the
   * `order('month', desc).limit(1)` every live-plan reader uses, so the future
   * plan would take over mid-month and the current month's remaining slots
   * would never materialize. The scheduler promotes it on the 1st instead.
   */
  staged?: boolean;
};

/**
 * The profile a build should plan from, or null when it must not run.
 *
 * A profile whose business has no name never came back from a real crawl, so it
 * carries nothing the strategist can use beyond the hostname — which is exactly
 * what the fallback supplies.
 */
export function planningProfile(
  site: SiteProfile | null | undefined,
  hostname: string,
  fallback = false,
): SiteProfile | null {
  if (site?.business?.name) return site;
  return fallback ? blankProfile(hostname) : null;
}

export type EnsureDomain = {
  id: string;
  hostname: string;
  posts_per_week: number | null;
  site_profile: SiteProfile | null;
  interview: unknown;
  /** Owner — used to look up the plan allowance the calendar is capped to. */
  user_id?: string | null;
};

export function monthBounds(now = new Date()) {
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { thisMonth, prevMonth };
}

export async function ensureMonthlyStrategy(
  domain: EnsureDomain,
  opts: EnsureOptions = {},
): Promise<EnsureResult> {
  const sb = supabaseAdmin();
  const startedAt = Date.now();
  const { thisMonth, prevMonth } = monthBounds(opts.month ?? new Date());
  const monthDate = thisMonth.toISOString().slice(0, 10);
  const monthLabel = thisMonth.toISOString().slice(0, 7);

  // A staged month is matched on the month alone, not on `active`. Its whole
  // point is that it is inactive, so an active-only check would rebuild it —
  // and burn a top-tier planning call — on every tick until the 1st.
  const existingQuery = sb
    .from('strategies')
    .select('id')
    .eq('domain_id', domain.id)
    .eq('month', monthDate);
  const { data: existing } = opts.staged
    ? await existingQuery.limit(1).maybeSingle()
    : await existingQuery.eq('active', true).maybeSingle();
  if (existing && !opts.replaceActive) return 'exists';

  const profile = planningProfile(domain.site_profile, domain.hostname, opts.profileFallback);
  if (!profile) return 'no_profile';

  const { data: prev } = await sb
    .from('strategies')
    .select('*')
    .eq('domain_id', domain.id)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();

  const report = await summarizeMonth(domain.id, prevMonth, thisMonth);

  const { data: covered } = await sb
    .from('topic_memory')
    .select('keyword')
    .eq('domain_id', domain.id)
    .order('created_at', { ascending: false })
    .limit(60);
  const alreadyCovered = (covered ?? []).map((r: any) => r.keyword).filter(Boolean);

  // The rolling weekly log — how the season actually went, week by week.
  const ctx = await getAgentContext(domain.id);

  // Cap the calendar at what the owner's plan actually includes — planning past
  // it just manufactures slots the drain will refuse as over-quota.
  const monthlyQuota = domain.user_id ? (await getQuota(domain.user_id)).limit : null;

  const strategy = await buildStrategy({
    month: monthLabel,
    postsPerWeek: domain.posts_per_week ?? 4,
    monthlyQuota,
    profile,
    interview: parseInterview(domain.interview as any),
    prevStrategy: (prev as any) as Strategy | null,
    prevReport: report,
    progressMd: ctx.progress_md,
    alreadyCovered,
    // What's actually LEFT, not what we started with. Everything above this
    // line is round trips against Postgres.
    budgetMs: opts.budgetMs == null ? undefined : opts.budgetMs - (Date.now() - startedAt),
  });

  // Only a plan that goes live now displaces the current one. A staged plan
  // must leave it running — the month it covers hasn't started.
  if (!opts.staged) {
    await sb.from('strategies').update({ active: false })
      .eq('domain_id', domain.id).eq('active', true);
  }

  const row = {
    domain_id: domain.id,
    month: monthDate,
    source: strategy.source,
    goals: strategy.goals,
    kpis: strategy.kpis,
    pillars: strategy.pillars,
    publishing_plan: strategy.publishing_plan,
    direction: strategy.direction ?? null,
    interview: domain.interview ?? null,
    prev_review: report,
    notes: strategy.notes,
    active: !opts.staged,
  };

  // planned_by lands in migration 0029. Until that's applied the column doesn't
  // exist and including it would fail the whole insert — losing the plan to
  // save a diagnostic. Write it when we can, drop it when we can't.
  const { error: insertErr } = await sb
    .from('strategies')
    .insert({ ...row, planned_by: strategy.planned_by ?? null });
  if (insertErr) {
    // The retry's error used to be discarded, and 'created' returned anyway —
    // so a plan that was never written reported success to the cron, which
    // logged a clean build and moved on. A failed write must be loud.
    const { error: retryErr } = await sb.from('strategies').insert(row);
    if (retryErr) {
      throw new Error(
        `strategy insert failed for ${domain.hostname} ${monthDate}: ` +
        `${retryErr.message} (first attempt: ${insertErr.message})`,
      );
    }
  }

  // Refresh the plan memo the chat + downstream prompts read — but only for the
  // plan that is actually live. A staged month must not start describing itself
  // to the owner (or to the writer) weeks before it begins.
  if (!opts.staged) await savePlanContext(domain.id, strategy, domain.hostname);

  // `planned_by` is the whole point of capturing this: a plan silently built by
  // the cheap workhorse instead of the strategy model is the exact failure that
  // went unnoticed before (see ARCHITECTURE / migration 0029), and it is
  // invisible in the product itself. Here it becomes a chart.
  if (domain.user_id) {
    await captureServer(domain.user_id, 'strategy_built', {
      domain_id: domain.id,
      source: strategy.source === 'interview' ? 'interview' : 'inferred',
      planned_by: strategy.planned_by ?? null,
      staged: !!opts.staged,
    });
  }

  return 'created';
}
