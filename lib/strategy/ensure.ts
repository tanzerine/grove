/**
 * ensureMonthlyStrategy — build + persist the current month's strategy for one
 * domain, if an active one doesn't already exist.
 *
 * Extracted from the monthly cron so it has two callers:
 *   - /api/cron/monthly-strategy on the 1st (the normal path)
 *   - /api/cron/scheduler daily (self-heal: if the monthly run was killed by a
 *     timeout or an LLM outage, the loop recovers within a day instead of
 *     staying dead until the 1st of the NEXT month — which is exactly the
 *     failure mode that stalled month 2 in production)
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
import type { SiteProfile } from '../pipeline/site-profile';

export type EnsureResult = 'created' | 'exists' | 'no_profile';

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
  opts: { llmTimeoutMs?: number } = {},
): Promise<EnsureResult> {
  const sb = supabaseAdmin();
  const { thisMonth, prevMonth } = monthBounds();
  const monthDate = thisMonth.toISOString().slice(0, 10);
  const monthLabel = thisMonth.toISOString().slice(0, 7);

  const { data: existing } = await sb
    .from('strategies')
    .select('id')
    .eq('domain_id', domain.id)
    .eq('month', monthDate)
    .eq('active', true)
    .maybeSingle();
  if (existing) return 'exists';

  const profile = domain.site_profile;
  if (!profile?.business?.name) return 'no_profile';

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
    llmTimeoutMs: opts.llmTimeoutMs,
  });

  await sb.from('strategies').update({ active: false })
    .eq('domain_id', domain.id).eq('active', true);
  await sb.from('strategies').insert({
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
    active: true,
  });

  // Refresh the plan memo the chat + downstream prompts read.
  await savePlanContext(domain.id, strategy, domain.hostname);

  return 'created';
}
