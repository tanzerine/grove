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
import { planningTargets } from '@/lib/strategy/rollover';
import { entitledUserSet } from '@/lib/billing';
import { STRATEGY_BUDGET_MS } from '@/lib/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ ok: false }, { status: 401 });

  const sb = supabaseAdmin();

  // Verified only: an unverified domain can't publish, so planning for it just
  // spends the budget. Deterministic order so a backlog drains predictably.
  const { data: domains } = await sb
    .from('domains')
    .select('id,hostname,posts_per_week,site_profile,interview,user_id')
    .not('verified_at', 'is', null)
    .order('created_at', { ascending: true });

  // Planning is top-tier spend — paying accounts only.
  const entitled = await entitledUserSet((domains ?? []).map((d: any) => d.user_id));
  const plannable = (domains ?? []).filter(
    (d: any) => entitled.has(d.user_id) && d.site_profile?.business?.name,
  );

  // The current month first, then next month once inside the lookahead window.
  // Ordering is the priority rule: a domain publishing nothing RIGHT NOW always
  // outranks a head start on a month that hasn't begun.
  const targets = planningTargets(new Date());

  for (const target of targets) {
    // A staged month is covered by any row for it; the live month only by an
    // active one, so a superseded revision doesn't read as covered.
    const coverQuery = sb.from('strategies').select('domain_id').eq('month', target.month);
    const { data: haveStrategy } = target.staged
      ? await coverQuery
      : await coverQuery.eq('active', true);
    const covered = new Set((haveStrategy ?? []).map((r: any) => r.domain_id));

    const pending = plannable.filter((d: any) => !covered.has(d.id));
    if (!pending.length) continue;

    // ONE domain. The whole point of this route is that the planner doesn't
    // share — it needs ~3-4 uninterrupted minutes to reach the strategy model.
    const domain = pending[0];
    try {
      const status = await ensureMonthlyStrategy(domain as EnsureDomain, {
        llmTimeoutMs: STRATEGY_BUDGET_MS,
        month: new Date(`${target.month}T00:00:00.000Z`),
        staged: target.staged,
      });
      return NextResponse.json({
        ok: true,
        month: target.month,
        staged: target.staged,
        built: { domain_id: domain.id, hostname: domain.hostname, status },
        pending: pending.length - 1,
      });
    } catch (err: any) {
      console.error('[cron/strategy] build failed:', domain.id, target.month, err);
      return NextResponse.json({
        ok: false,
        month: target.month,
        staged: target.staged,
        built: { domain_id: domain.id, hostname: domain.hostname, status: 'error', note: String(err?.message ?? err) },
        pending: pending.length - 1,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    month: targets[0].month,
    built: null,
    pending: 0,
  });
}
