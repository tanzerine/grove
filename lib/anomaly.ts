/**
 * Lightweight anomaly detection for the admin overview + daily digest.
 *
 * Reads existing first-party signals (no new tables): rate_hits (API request
 * volume + denial-of-wallet), post_events (traffic / bot / single-source
 * hammering), auth signups, and recent Stripe charges (card-testing fraud).
 *
 * Server-only, service-role, and fail-soft: any source that errors is skipped
 * rather than throwing. Thresholds are deliberately generous for an early-stage
 * product — tune the T constants (or wire to env) as real traffic establishes a
 * baseline. The hard protection is the rate limiter; these flags are awareness.
 */
import { supabaseAdmin } from './supabase/admin';
import { getStripe, stripeConfigured } from './stripe';
import { LIMITS } from './ratelimit';
import { entitledUserSet } from './billing';
import { monthKey, startOfMonthUTC } from './strategy/rollover';
import {
  capacityReport,
  committedPostsPerMonth,
  estimateGenerationMs,
  generationDurationMs,
  postsPerTick,
  resolveTickBudgetMs,
  schedulerTicksPerDay,
} from './pipeline/capacity';

/** Mirrors `maxDuration` in app/api/cron/scheduler/route.ts. */
const SCHEDULER_MAX_DURATION_SEC = 300;

export type Flag = {
  key: string;
  severity: 'warn' | 'critical';
  title: string;
  detail: string;
};

// Thresholds. Absolute numbers + a relative multiplier vs the trailing baseline.
const T = {
  apiWarn: 300, apiCrit: 1000,          // rate_hits in the last hour
  trafficWarn: 800, trafficCrit: 4000,  // post_events (views) in the last hour
  trafficRelMin: 150, trafficRelMult: 6, // relative spike vs 24h hourly average
  botMinViews: 80, botRatio: 0.6,       // bot share of last-hour traffic
  ipHammerPerHour: 250,                 // events from one /24 (or /48) ip prefix
  signupWarn: 8, signupCrit: 30,        // new users in the last hour
  failedPayWarn: 4, failedPayCrit: 15,  // failed charges in the last 24h
  capacityWarnRatio: 0.75,              // sold quota ÷ deliverable capacity
  queueStallHours: 6,                   // oldest queued post still waiting
};

const iso = (ms: number) => new Date(ms).toISOString();

export async function detectAnomalies(): Promise<Flag[]> {
  const admin = supabaseAdmin();
  const now = Date.now();
  const h1 = iso(now - 3600_000);
  const h24 = iso(now - 24 * 3600_000);
  const flags: Flag[] = [];

  // ── API request volume + denial-of-wallet (rate_hits) ──
  try {
    const { data } = await admin
      .from('rate_hits')
      .select('bucket')
      .gte('created_at', h1)
      .limit(5000);
    const rows = data ?? [];
    const apiTotal = rows.length;
    if (apiTotal >= T.apiCrit) {
      flags.push({ key: 'api_spike', severity: 'critical', title: 'API request spike', detail: `${apiTotal} rate-limited API hits in the last hour.` });
    } else if (apiTotal >= T.apiWarn) {
      flags.push({ key: 'api_spike', severity: 'warn', title: 'Elevated API usage', detail: `${apiTotal} API hits in the last hour.` });
    }

    // Any single cost-bearing bucket sitting at its ceiling = someone being
    // throttled hard (possible denial-of-wallet attempt — already blocked).
    const byBucket = new Map<string, number>();
    for (const r of rows) byBucket.set((r as any).bucket, (byBucket.get((r as any).bucket) ?? 0) + 1);
    for (const [bucket, count] of byBucket) {
      const prefix = bucket.split(':')[0] as keyof typeof LIMITS;
      const limit = LIMITS[prefix]?.limit;
      if (limit && count >= limit) {
        flags.push({ key: 'wallet_ratelimit', severity: 'warn', title: 'Cost endpoint at its limit', detail: `Bucket "${bucket}" hit its ${limit}/hr cap — repeated throttling (denial-of-wallet attempt blocked).` });
        break; // one flag is enough; detail names the worst offender
      }
    }
  } catch { /* rate_hits unreadable */ }

  // ── Traffic / bot / single-source hammering (post_events) ──
  try {
    const { data } = await admin
      .from('post_events')
      .select('type, ua_kind, ip_prefix')
      .gte('created_at', h1)
      .limit(8000);
    const rows = data ?? [];
    const views = rows.filter((r) => (r as any).type === 'view');
    const viewCount = views.length;
    const botCount = views.filter((r) => (r as any).ua_kind === 'bot').length;

    // 24h baseline for relative spike detection.
    let baselineHourly = 0;
    try {
      const { count } = await admin
        .from('post_events')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'view')
        .gte('created_at', h24);
      baselineHourly = (count ?? 0) / 24;
    } catch { /* baseline optional */ }

    const relSpike = viewCount > T.trafficRelMin && baselineHourly > 0 && viewCount > baselineHourly * T.trafficRelMult;
    if (viewCount >= T.trafficCrit) {
      flags.push({ key: 'traffic_spike', severity: 'critical', title: 'Traffic spike', detail: `${viewCount} page views in the last hour.` });
    } else if (viewCount >= T.trafficWarn || relSpike) {
      flags.push({ key: 'traffic_spike', severity: 'warn', title: 'Traffic spike', detail: `${viewCount} page views in the last hour${baselineHourly ? ` (~${Math.round(baselineHourly)}/hr typical)` : ''}.` });
    }

    if (viewCount >= T.botMinViews && botCount / viewCount >= T.botRatio) {
      flags.push({ key: 'bot_traffic', severity: 'warn', title: 'High bot traffic', detail: `${Math.round((botCount / viewCount) * 100)}% of the last hour's ${viewCount} views were bots.` });
    }

    const byIp = new Map<string, number>();
    for (const r of rows) {
      const ip = (r as any).ip_prefix as string | null;
      if (ip) byIp.set(ip, (byIp.get(ip) ?? 0) + 1);
    }
    for (const [ip, count] of byIp) {
      if (count >= T.ipHammerPerHour) {
        flags.push({ key: 'ip_hammer', severity: 'warn', title: 'Single source hammering', detail: `One IP range (${ip}) made ${count} events in the last hour.` });
        break;
      }
    }
  } catch { /* post_events unreadable */ }

  // ── Signup spike (possible bot wave) ──
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const cutoff = now - 3600_000;
    const recent = (data?.users ?? []).filter((u) => new Date(u.created_at).getTime() >= cutoff).length;
    if (recent >= T.signupCrit) {
      flags.push({ key: 'signup_spike', severity: 'critical', title: 'Signup surge', detail: `${recent} new accounts in the last hour — possible bot wave.` });
    } else if (recent >= T.signupWarn) {
      flags.push({ key: 'signup_spike', severity: 'warn', title: 'Signup surge', detail: `${recent} new accounts in the last hour.` });
    }
  } catch { /* listUsers unavailable */ }

  // ── Failed payments (card-testing fraud) ──
  if (stripeConfigured()) {
    try {
      const charges = await getStripe().charges.list({ created: { gte: Math.floor((now - 24 * 3600_000) / 1000) }, limit: 100 });
      const failed = charges.data.filter((c) => c.status === 'failed').length;
      if (failed >= T.failedPayCrit) {
        flags.push({ key: 'failed_payments', severity: 'critical', title: 'Many failed payments', detail: `${failed} failed charges in the last 24h — possible card testing.` });
      } else if (failed >= T.failedPayWarn) {
        flags.push({ key: 'failed_payments', severity: 'warn', title: 'Failed payments', detail: `${failed} failed charges in the last 24h.` });
      }
    } catch { /* Stripe read failed */ }
  }

  // ── Sold quota vs deliverable capacity ──
  // Not a spike but the same class of problem: something is wrong and nobody
  // would notice. The scheduler can only produce ticks/day × posts/tick; when
  // live subscriptions promise more than that, every customer quietly gets less
  // than their plan and the only symptom is a queue that never drains. Flag it
  // while it's still a pricing decision rather than a support queue.
  try {
    const { data: subs } = await admin
      .from('subscriptions')
      .select('plan, stripe_status')
      .in('stripe_status', ['active', 'trialing']);
    const { data: recent } = await admin
      .from('posts')
      .select('generation_log')
      .in('status', ['published', 'scheduled', 'review'])
      .order('created_at', { ascending: false })
      .limit(20);
    const samples = (recent ?? [])
      .map((r: any) => generationDurationMs(r.generation_log))
      .filter((n): n is number => n !== null);

    const report = capacityReport({
      ticksPerDay: schedulerTicksPerDay(),
      postsPerTick: postsPerTick(
        resolveTickBudgetMs(SCHEDULER_MAX_DURATION_SEC, process.env.GROVE_TICK_BUDGET_MS),
        estimateGenerationMs(samples),
      ),
      committedPerMonth: committedPostsPerMonth(subs ?? []),
    });

    if (report.oversubscribed) {
      flags.push({
        key: 'capacity_oversold',
        severity: 'critical',
        title: 'Sold more posts than we can generate',
        detail: `Live plans promise ${report.committedPerMonth} posts/month; the schedule can deliver about ${report.postsPerMonth} (${report.ticksPerDay} ticks/day × ${report.postsPerTick}). Raise the scheduler frequency in vercel.json or stop selling the top tier.`,
      });
    } else if (report.utilization >= T.capacityWarnRatio) {
      flags.push({
        key: 'capacity_tight',
        severity: 'warn',
        title: 'Generation capacity is tight',
        detail: `Live plans use ${Math.round(report.utilization * 100)}% of what the schedule can deliver (${report.committedPerMonth} of ~${report.postsPerMonth} posts/month). Add ticks before the next signups.`,
      });
    }
  } catch { /* subscriptions or posts unreadable */ }

  // ── THE AGENT LOOP ITSELF ──
  //
  // Every flag above watches traffic, money, or capacity. NONE of them watched
  // the thing the product actually sells. On 2026-08-01 the monthly plan build
  // failed on every tick for a day and a half: the paying domain had no live
  // plan, nothing materialized, nothing generated, nothing published — and the
  // admin overview was completely green the entire time. It was found because
  // a human went looking, which is not a monitoring strategy.
  //
  // A stopped loop must be louder than a traffic spike, because it is the only
  // failure the customer is actually paying us not to have.
  try {
    const { data: domains } = await admin
      .from('domains')
      .select('id, hostname, user_id, strategy_error')
      .not('verified_at', 'is', null);
    const entitled = await entitledUserSet((domains ?? []).map((d: any) => d.user_id));
    const live = (domains ?? []).filter((d: any) => entitled.has(d.user_id));

    if (live.length) {
      const month = monthKey(startOfMonthUTC(new Date()));
      const { data: plans } = await admin
        .from('strategies')
        .select('domain_id')
        .eq('month', month)
        .eq('active', true);
      const planned = new Set((plans ?? []).map((r: any) => r.domain_id));

      // No live plan for THIS month = publishing nothing, right now. There is
      // no degraded mode here: materializeDuePlanSlots reads the active plan,
      // so a domain without one queues nothing at all.
      const unplanned = live.filter((d: any) => !planned.has(d.id));
      if (unplanned.length) {
        flags.push({
          key: 'plan_missing',
          severity: 'critical',
          title: `${unplanned.length} paying domain${unplanned.length === 1 ? '' : 's'} with no plan this month`,
          detail: `${unplanned.map((d: any) => d.hostname).slice(0, 5).join(', ')}` +
            `${unplanned.length > 5 ? ` +${unplanned.length - 5} more` : ''} have no active ${month} strategy, ` +
            `so nothing is being queued or published for them. /api/cron/strategy retries hourly; ` +
            `check domains.strategy_error for the reason it isn't landing.`,
        });
      }

      // The reason, when the planner recorded one. This is the flag that would
      // have turned "the blog stopped" into "extractJson hit a truncated
      // publishing_plan" without anyone opening Vercel's logs.
      const failing = live.filter((d: any) => d.strategy_error);
      if (failing.length) {
        flags.push({
          key: 'plan_build_failing',
          severity: 'warn',
          title: `Plan build failing on ${failing.length} domain${failing.length === 1 ? '' : 's'}`,
          detail: failing.slice(0, 3)
            .map((d: any) => `${d.hostname}: ${String(d.strategy_error).slice(0, 160)}`)
            .join(' · '),
        });
      }

      // Generic backstop for the failure modes not yet imagined: work is queued
      // for a paying domain and simply isn't moving. Says the queue depth too,
      // so a real backlog (deep queue, oldest waiting) reads differently from a
      // stall (shallow queue, oldest waiting just as long).
      const liveIds = new Set(live.map((d: any) => d.id));
      const { data: queued } = await admin
        .from('posts')
        .select('domain_id, created_at')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1000);
      const mine = (queued ?? []).filter((p: any) => liveIds.has(p.domain_id));
      const oldest = mine[0]?.created_at ? new Date(mine[0].created_at).getTime() : null;
      const waitedH = oldest === null ? 0 : (now - oldest) / 3600_000;
      if (waitedH >= T.queueStallHours) {
        flags.push({
          key: 'queue_stalled',
          severity: waitedH >= T.queueStallHours * 2 ? 'critical' : 'warn',
          title: 'Queued posts are not being generated',
          detail: `The oldest queued post has waited ${Math.round(waitedH)}h with ${mine.length} in the queue. ` +
            `At roughly ${schedulerTicksPerDay()} ticks/day a shallow queue waiting this long means the drain ` +
            `isn't draining — check the scheduler cron, quota, and entitlement.`,
        });
      }
    }
  } catch { /* domains or strategies unreadable — never take the page down */ }

  return flags;
}
