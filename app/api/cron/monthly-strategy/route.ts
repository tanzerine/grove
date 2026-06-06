/**
 * GET /api/cron/monthly-strategy — runs on the 1st of each month.
 *
 * For every active domain:
 *  1. Aggregate last month's post_events into a MonthlyReport.
 *  2. Hand report + interview + previous strategy to `buildStrategy`.
 *  3. Deactivate the previous strategy and insert the new one.
 *
 * Idempotent: if a strategy for `(domain, month)` already exists and is
 * active, we skip without overwriting. Re-run safe.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildStrategy, type Strategy } from '@/lib/strategy/build';
import { summarizeMonth } from '@/lib/strategy/review';
import { parseInterview } from '@/lib/strategy/interview';
import type { SiteProfile } from '@/lib/pipeline/site-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function monthBounds(now = new Date()) {
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { thisMonth, prevMonth };
}

export async function GET(req: Request) {
  // basic shared-secret guard — Vercel cron sends the auth header it's configured with
  const auth = req.headers.get('authorization') ?? '';
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const { thisMonth, prevMonth } = monthBounds();
  const thisMonthLabel = thisMonth.toISOString().slice(0, 7);

  const { data: domains = [] } = await sb
    .from('domains')
    .select('id,hostname,posts_per_week,site_profile,interview');

  const results: Array<{ domain_id: string; status: string; note?: string }> = [];

  for (const domain of domains ?? []) {
    try {
      // skip if an active strategy already exists for this month
      const { data: existing } = await sb
        .from('strategies')
        .select('id')
        .eq('domain_id', domain.id)
        .eq('month', thisMonth.toISOString().slice(0, 10))
        .eq('active', true)
        .maybeSingle();
      if (existing) { results.push({ domain_id: domain.id, status: 'skipped' }); continue; }

      const profile: SiteProfile | null = (domain as any).site_profile ?? null;
      if (!profile?.business?.name) {
        results.push({ domain_id: domain.id, status: 'no_profile' });
        continue;
      }

      // load prev strategy (if any)
      const { data: prev } = await sb
        .from('strategies')
        .select('*')
        .eq('domain_id', domain.id)
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();

      // aggregate last month's events
      const report = await summarizeMonth(domain.id, prevMonth, thisMonth);

      const strategy = await buildStrategy({
        month: thisMonthLabel,
        postsPerWeek: domain.posts_per_week ?? 4,
        profile,
        interview: parseInterview((domain as any).interview),
        prevStrategy: (prev as any) as Strategy | null,
        prevReport: report,
      });

      // deactivate prev, insert new
      await sb.from('strategies').update({ active: false })
        .eq('domain_id', domain.id).eq('active', true);
      await sb.from('strategies').insert({
        domain_id: domain.id,
        month: thisMonth.toISOString().slice(0, 10),
        source: strategy.source,
        goals: strategy.goals,
        kpis: strategy.kpis,
        pillars: strategy.pillars,
        publishing_plan: strategy.publishing_plan,
        interview: (domain as any).interview ?? null,
        prev_review: report,
        notes: strategy.notes,
        active: true,
      });

      results.push({ domain_id: domain.id, status: 'created' });
    } catch (err: any) {
      results.push({ domain_id: domain.id, status: 'error', note: String(err?.message ?? err) });
    }
  }

  return NextResponse.json({ ok: true, month: thisMonthLabel, results });
}
