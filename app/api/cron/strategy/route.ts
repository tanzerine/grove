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
 * Guarded by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { ensureMonthlyStrategy, type EnsureDomain } from '@/lib/strategy/ensure';
import { planningQueue, planningTargets } from '@/lib/strategy/rollover';
import { splitStrategyBudget } from '@/lib/llm';
import { entitledUserSet } from '@/lib/billing';

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

  return NextResponse.json({
    ok: attempts.every((a) => a.status !== 'error'),
    month: targets[0].month,
    built: null,
    attempts,
    pending: pendingAfter,
  });
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
