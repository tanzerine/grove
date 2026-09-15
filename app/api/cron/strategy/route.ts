/**
 * GET /api/cron/strategy — build ONE missing monthly plan per tick.
 *
 * WHY THIS EXISTS. Strategy is the highest-leverage LLM step in the product, so
 * lib/llm routes it to a top-tier model. But a full plan takes that model ~3-4
 * minutes, and every automated caller was squeezing it into a slice of a
 * shared 300s invocation: the monthly cron gave each domain 120s, the
 * scheduler's self-heal the same. Both sat under strategyLlmCall's
 * STRATEGY_MIN_BUDGET_MS, so the top tier was skipped every single time and
 * 100% of automated plans were built by the cheap workhorse. Nothing said so.
 *
 * The fix isn't a bigger number — it's not sharing. This route does one domain
 * per invocation with the whole function to itself, so the planner gets a
 * budget it can actually finish in. Running hourly, a backlog of N domains
 * clears in N hours, which is immaterial for something that changes monthly.
 *
 * This mirrors what /api/cron/images already did for cover generation, and for
 * the same reason: work that needs a big uninterrupted slice gets starved when
 * it shares a tick with a queue drain.
 *
 * ONE DOMAIN PER TICK IS NOT ONE ATTEMPT PER TICK. That conflation is what took
 * planning down platform-wide on 2026-08-01. The route picked the first
 * unplanned domain by `created_at` and returned whatever came back — built,
 * failed, or nothing to do. Because only a SUCCESSFUL build leaves the pending
 * set, a domain that could not be planned was picked first again on the next
 * tick, and the next: every other customer sat behind it unplanned all day,
 * and with no live plan `materializeDuePlanSlots` queues nothing, the drain
 * drafts nothing, and nothing publishes. The whole loop stopped, quietly,
 * behind one bad row.
 *
 * So this tick now spends its BUDGET, not its first attempt:
 *   - the queue rotates on attempt (planningQueue), so a domain that always
 *     fails costs one tick per rotation instead of every tick;
 *   - a failure moves on to the next domain while the invocation still has
 *     room for a full-tier build, instead of ending the tick;
 *   - 'exists' and 'no_profile' cost no model time, so they never end it;
 *   - the reason a build failed is written to the domain, not just to Vercel's
 *     logs, because "why has this domain had no plan for ten hours" has to be
 *     answerable from the product.
 *
 * Idempotent and safe to run often — ensureMonthlyStrategy short-circuits on an
 * existing active plan for (domain, month), so a tick with nothing to do is a
 * couple of cheap queries.
 *
 * AND THAT SHORT-CIRCUIT IS ALSO A TRAP, which is what the third pass below is
 * for. A plan, once written, was frozen until the 1st of the next month: ship a
 * planner improvement mid-month and it reached only the domains that happened
 * to have no plan yet. With two verified sites on one account that reads as
 * "strategy only works on one domain" — www.oveners.com was planned on
 * 2026-09-06 and trygroveai.com rebuilt on the 13th, the day the keyword ledger
 * landed, so one strategy page had 775 candidates behind it and the other had
 * zero, permanently. So the tick now spends leftover budget refreshing a plan
 * the current planner would build differently, STRICTLY behind every domain
 * that has no plan at all. lib/strategy/freshness.ts is the whole policy,
 * including why it cannot loop and why a language mismatch never triggers one.
 *
 * Guarded by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { ensureMonthlyStrategy, type EnsureDomain } from '@/lib/strategy/ensure';
import { planningQueue, planningTargets } from '@/lib/strategy/rollover';
import { planFreshness, refreshCooledDown } from '@/lib/strategy/freshness';
import { splitStrategyBudget } from '@/lib/llm';
import { entitledUserSet } from '@/lib/billing';
import { languageForDomain } from '@/lib/language';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The columns migration 0031 adds. Selected separately so a deploy that lands
 *  before the migration degrades to "no rotation" instead of "no plan". */
const ATTEMPT_COLUMNS = 'created_at,strategy_attempted_at';

type Attempt = {
  domain_id: string;
  hostname: string;
  status: string;
  note?: string;
};

/** A domain whose LIVE plan is out of date, with the reasons, ready to rebuild. */
type StaleDomain = EnsureDomain & {
  created_at?: string | null;
  strategy_attempted_at?: string | null;
  reasons: string[];
};

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = supabaseAdmin();
  const startedAt = Date.now();
  const budgetMs = maxDuration * 1000;
  const remainingMs = () => budgetMs - (Date.now() - startedAt);

  // Verified only: an unverified domain can't publish, so planning for it just
  // spends the budget. `created_at` remains the tiebreak, so the order is still
  // deterministic once every domain has been attempted the same number of times.
  const base = 'id,hostname,posts_per_week,site_profile,interview,user_id,language';
  const withAttempts = await sb
    .from('domains')
    .select(`${base},${ATTEMPT_COLUMNS}`)
    .not('verified_at', 'is', null);
  let domains: any[] | null = withAttempts.data;
  if (withAttempts.error) {
    // 0031 not applied yet — plan without the rotation rather than not at all.
    const { data } = await sb
      .from('domains')
      .select(`${base},created_at`)
      .not('verified_at', 'is', null);
    domains = data;
  }

  // Planning is top-tier spend — paying accounts only.
  const entitled = await entitledUserSet((domains ?? []).map((d: any) => d.user_id));
  const plannable = (domains ?? []).filter(
    (d: any) => entitled.has(d.user_id) && d.site_profile?.business?.name,
  );

  // The current month first, then next month once inside the lookahead window.
  // Ordering is the priority rule: a domain publishing nothing RIGHT NOW always
  // outranks a head start on a month that hasn't begun.
  const targets = planningTargets(new Date());

  const attempts: Attempt[] = [];
  let built: Attempt | null = null;
  let pendingAfter = 0;
  let outOfBudget = false;

  for (const target of targets) {
    if (outOfBudget) break;
    // A staged month is covered by any row for it; the live month only by an
    // active one, so a superseded revision doesn't read as covered.
    const coverQuery = sb.from('strategies').select('domain_id').eq('month', target.month);
    const { data: haveStrategy } = target.staged
      ? await coverQuery
      : await coverQuery.eq('active', true);
    const covered = new Set((haveStrategy ?? []).map((r: any) => r.domain_id));

    const pending = planningQueue(plannable.filter((d: any) => !covered.has(d.id)) as any[]);
    if (!pending.length) continue;

    // Per-target: how many domains still have no plan for THIS month once the
    // tick ends. A domain that was attempted and failed is still unplanned, so
    // only a build decrements it.
    pendingAfter = pending.length;

    for (const domain of pending as EnsureDomain[]) {
      // Never START a build this invocation can't finish at full tier: below
      // that floor splitStrategyBudget skips the strategy model entirely, which
      // is the silent demotion to the workhorse this route exists to prevent.
      // A doomed or demoted build is worse than leaving the domain for the next
      // tick — it burns the budget AND persists a cheap plan as if it were real.
      if (attempts.length && splitStrategyBudget(remainingMs()).primaryMs === 0) {
        outOfBudget = true;
        break;
      }

      // Stamp the attempt BEFORE the build. After would never run for the
      // failure that matters most — the platform killing the function mid-call
      // — and that domain would hold the front of the queue forever, which is
      // the exact starvation this is here to end.
      await markAttempt(sb, domain.id);

      try {
        const status = await ensureMonthlyStrategy(domain, {
          // What's LEFT of the invocation, not its ceiling. Handing the full
          // maxDuration to a second attempt is how the ladder once asked for
          // more wall clock than the function had and died uncatchably.
          budgetMs: remainingMs(),
          month: new Date(`${target.month}T00:00:00.000Z`),
          staged: target.staged,
        });
        attempts.push({ domain_id: domain.id, hostname: domain.hostname, status });
        if (status === 'created') {
          await clearError(sb, domain.id);
          built = attempts[attempts.length - 1];
          pendingAfter = pending.length - 1;
          break;
        }
        // 'exists' / 'no_profile' spent no model time — the tick is still young.
      } catch (err: any) {
        const note = String(err?.message ?? err);
        console.error('[cron/strategy] build failed:', domain.id, target.month, err);
        await recordError(sb, domain.id, note);
        attempts.push({ domain_id: domain.id, hostname: domain.hostname, status: 'error', note });
      }
    }

    if (built) {
      return NextResponse.json({
        ok: true,
        month: target.month,
        staged: target.staged,
        built,
        attempts,
        pending: pendingAfter,
      });
    }
  }

  // ── third priority: REFRESH a live plan the current planner would build
  //    differently. Only reached when nothing above needed a plan at all, so a
  //    domain publishing nothing right now can never wait behind a domain whose
  //    plan merely predates a pipeline change.
  let refreshed: Attempt | null = null;
  let refreshable = 0;
  if (!outOfBudget && splitStrategyBudget(remainingMs()).primaryMs > 0) {
    const stale = await staleLivePlans(sb, plannable, new Date());
    refreshable = stale.length;
    const target = planningQueue(stale)[0];
    if (target) {
      await markAttempt(sb, target.id);
      try {
        // replaceActive, because the whole point is that a plan already exists
        // for this month and is the thing being replaced.
        const status = await ensureMonthlyStrategy(target as EnsureDomain, {
          budgetMs: remainingMs(),
          replaceActive: true,
        });
        refreshed = { domain_id: target.id, hostname: target.hostname, status, note: target.reasons.join(',') };
        if (status === 'created') {
          await clearError(sb, target.id);
          refreshable -= 1;
        }
        attempts.push(refreshed);
      } catch (err: any) {
        const note = String(err?.message ?? err);
        console.error('[cron/strategy] refresh failed:', target.id, err);
        await recordError(sb, target.id, note);
        attempts.push({ domain_id: target.id, hostname: target.hostname, status: 'error', note });
      }
    }
  }

  return NextResponse.json({
    ok: attempts.every((a) => a.status !== 'error'),
    month: targets[0].month,
    built: null,
    refreshed,
    refreshable,
    attempts,
    pending: pendingAfter,
  });
}

/**
 * The domains whose LIVE plan the current planner would build differently.
 *
 * Reads only what is already stored — the active plan, whether any
 * keyword_candidates row points at it, and whether it carries the customer
 * profile it was built for — and hands the decision to lib/strategy/freshness,
 * which is pure and holds the reasoning for both halves that matter: why the
 * epoch is what stops this from looping, and why a language mismatch is
 * reported but never acted on.
 *
 * Best-effort throughout. This is a catch-up pass over plans that already work;
 * a query that fails here must cost the refresh, never the tick.
 */
async function staleLivePlans(
  sb: ReturnType<typeof supabaseAdmin>,
  domains: any[],
  now: Date,
): Promise<StaleDomain[]> {
  if (!domains.length) return [];
  try {
    const { data: live } = await sb
      .from('strategies')
      .select('id, domain_id, month, created_at, pillars, publishing_plan, customer_profile')
      .in('domain_id', domains.map((d: any) => d.id))
      .eq('active', true);
    if (!live?.length) return [];

    // One query for the whole tick: which of these plans has a keyword ledger
    // behind it. A plan with no row here is one the tracker's steps 3-5 have
    // nothing to draw.
    const { data: ledger } = await sb
      .from('keyword_candidates')
      .select('strategy_id')
      .in('strategy_id', live.map((r: any) => r.id))
      .limit(1000);
    const backed = new Set((ledger ?? []).map((r: any) => r.strategy_id));

    const byDomain = new Map<string, any>(domains.map((d: any) => [d.id, d]));
    const out: StaleDomain[] = [];
    for (const row of live as any[]) {
      const domain = byDomain.get(row.domain_id);
      if (!domain) continue;
      // A stale plan is not an outage: a domain whose rebuild just failed waits
      // a day rather than spending the platform's best model every hour.
      if (!refreshCooledDown(domain.strategy_attempted_at, now)) continue;

      const { reasons, autoRebuild } = planFreshness({
        month: row.month,
        createdAt: row.created_at,
        hasKeywordLedger: backed.has(row.id),
        hasCustomerProfile: !!row.customer_profile,
        strategy: { pillars: row.pillars ?? [], publishing_plan: row.publishing_plan ?? [] },
        lang: languageForDomain(domain).code,
        now,
      });
      if (autoRebuild) out.push({ ...(domain as EnsureDomain), reasons, strategy_attempted_at: domain.strategy_attempted_at, created_at: domain.created_at });
    }
    return out;
  } catch (e) {
    console.error('[cron/strategy] stale-plan scan failed:', e);
    return [];
  }
}

/** Best-effort: an unapplied 0031 must not take the build down with it. */
async function markAttempt(sb: ReturnType<typeof supabaseAdmin>, domainId: string) {
  try {
    await sb.from('domains')
      .update({ strategy_attempted_at: new Date().toISOString() })
      .eq('id', domainId);
  } catch { /* no rotation until the migration lands — still plan */ }
}

async function recordError(sb: ReturnType<typeof supabaseAdmin>, domainId: string, note: string) {
  try {
    await sb.from('domains').update({ strategy_error: note.slice(0, 500) }).eq('id', domainId);
  } catch { /* diagnostic only — never fail the tick over it */ }
}

async function clearError(sb: ReturnType<typeof supabaseAdmin>, domainId: string) {
  try {
    await sb.from('domains').update({ strategy_error: null }).eq('id', domainId);
  } catch { /* ditto */ }
}
