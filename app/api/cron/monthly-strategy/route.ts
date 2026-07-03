/**
 * GET /api/cron/monthly-strategy — runs on the 1st of each month.
 *
 * For every verified, generation-entitled domain, ensure the current month's
 * strategy exists (aggregate last month's events → buildStrategy → persist).
 * The per-domain work lives in lib/strategy/ensure.ts, shared with the daily
 * scheduler's self-heal pass — so a failed monthly run recovers within a day
 * instead of stalling the loop until the next 1st.
 *
 * Idempotent: if a strategy for `(domain, month)` already exists and is
 * active, we skip without overwriting. Re-run safe.
 *
 * Budgeted: buildStrategy is an Opus-tier call that can run minutes. Domains
 * are processed sequentially against a wall-clock deadline; whatever doesn't
 * fit is reported as 'deferred' and picked up by the daily self-heal. This is
 * what prevents one slow LLM call from letting the platform kill the whole
 * invocation with zero strategies written.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { ensureMonthlyStrategy, monthBounds, type EnsureDomain } from '@/lib/strategy/ensure';
import { entitledUserSet } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Leave headroom under maxDuration for the response + the in-flight domain.
const RUN_BUDGET_MS = 240_000;
// Per-domain LLM cap: an Opus timeout + workhorse fallback must fit the budget.
const LLM_TIMEOUT_MS = 120_000;

export async function GET(req: Request) {
  // Shared-secret guard — fails closed when CRON_SECRET is unset.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const startedAt = Date.now();
  const sb = supabaseAdmin();
  const thisMonthLabel = monthBounds().thisMonth.toISOString().slice(0, 7);

  // Verified only: unverified domains can't publish, so planning for them
  // only burns the budget. Deterministic order so a deferred tail is stable.
  const { data: domains = [] } = await sb
    .from('domains')
    .select('id,hostname,posts_per_week,site_profile,interview,user_id')
    .not('verified_at', 'is', null)
    .order('created_at', { ascending: true });

  // Strategy building is Opus-tier spend — paying accounts only.
  const entitled = await entitledUserSet((domains ?? []).map((d: any) => d.user_id));

  const results: Array<{ domain_id: string; status: string; note?: string }> = [];

  for (const domain of domains ?? []) {
    if (!entitled.has((domain as any).user_id)) {
      results.push({ domain_id: domain.id, status: 'not_paying' });
      continue;
    }
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      results.push({ domain_id: domain.id, status: 'deferred' });
      continue;
    }
    try {
      const status = await ensureMonthlyStrategy(domain as EnsureDomain, { llmTimeoutMs: LLM_TIMEOUT_MS });
      results.push({ domain_id: domain.id, status: status === 'exists' ? 'skipped' : status });
    } catch (err: any) {
      results.push({ domain_id: domain.id, status: 'error', note: String(err?.message ?? err) });
    }
  }

  const failed = results.filter((r) => r.status === 'error' || r.status === 'deferred');
  if (failed.length) console.error('[monthly-strategy] incomplete:', JSON.stringify(failed));

  return NextResponse.json({ ok: true, month: thisMonthLabel, results });
}
