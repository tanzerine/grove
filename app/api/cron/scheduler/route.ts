/**
 * The core loop, run on the schedule in vercel.json:
 *   1. publish any 'scheduled' posts whose time has come (+ social fanout)
 *   2. reclaim generations the platform killed mid-flight
 *   3. self-heal the monthly strategy, materialize due plan slots
 *   4. drain the 'queued' bucket by generating drafts
 *   5. refresh Search Console snapshots
 *
 * Cover + inline image backfill lives in its own cron (/api/cron/images) so it
 * isn't starved by the generation drain above.
 *
 * THROUGHPUT. The drain used to generate a hardcoded 3 posts per tick, which on
 * a once-daily cron capped the entire platform at ~90 posts/month — less than a
 * single Agency subscription sells. It now works to a wall-clock budget instead:
 * it keeps starting articles while the measured cost of a generation still fits
 * in the time this invocation has left. Capacity therefore scales on two axes
 * that are both configuration, not code —
 *
 *   posts/day = ticks per day (vercel.json) × posts per tick (maxDuration)
 *
 * — so moving this cron from daily to hourly multiplies throughput by 24 with no
 * change to this file. lib/pipeline/capacity holds the arithmetic and reports
 * deliverable capacity against sold quota so overselling surfaces on the admin
 * overview instead of as silent under-delivery.
 *
 * Guarded by CRON_SECRET — Vercel sends it as a Bearer token automatically.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { generatePost } from '@/lib/pipeline/generate';
import { pickQueuedFairly } from '@/lib/pipeline/drain-order';
import { runSocialAdapter } from '@/lib/pipeline/writer';
import { seedLog } from '@/lib/pipeline/log';
import {
  GSC_RESERVE_MS,
  MAX_POSTS_PER_TICK,
  WORKING_STATUSES,
  estimateGenerationMs,
  generationDurationMs,
  hasRoomFor,
  isStranded,
  resolveTickBudgetMs,
  schedulerTicksPerDay,
} from '@/lib/pipeline/capacity';
import { materializeDuePlanSlots } from '@/lib/strategy/materialize';
import { ensureMonthlyStrategy, monthBounds, type EnsureDomain } from '@/lib/strategy/ensure';
import { entitledUserSet } from '@/lib/billing';
import { consumeQuota, quotaForUsers, releaseQuota } from '@/lib/quota';
import { publishToSocials } from '@/lib/social/publish';
import { syncDomain } from '@/lib/search-console/sync';

export const maxDuration = 300;

/** Sampled from recent finished posts to size the drain. */
const DURATION_SAMPLE_SIZE = 20;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();
  const startedAt = Date.now();
  const budgetMs = resolveTickBudgetMs(maxDuration, process.env.GROVE_TICK_BUDGET_MS);
  const elapsed = () => Date.now() - startedAt;

  // Prune rate-limiter rows older than any window (best-effort; ignore errors).
  await sb.from('rate_hits').delete().lt('created_at', new Date(Date.now() - 2 * 3600_000).toISOString());

  // 1) publish scheduled posts whose time has come, then fan out to socials
  const now = new Date().toISOString();
  const { data: due } = await sb
    .from('posts')
    .select('id, title, slug, body_md, social, cover_image_url, social_published, domain_id, domains(*)')
    .eq('status', 'scheduled').lte('scheduled_at', now);
  let socialFanout = 0;
  for (const p of due ?? []) {
    await sb.from('posts').update({ status: 'published', published_at: now }).eq('id', p.id);

    const domain = (p as any).domains;
    if (!domain?.auto_social) continue;
    try {
      // generate the social copy on demand if it wasn't created earlier
      let social = (p as any).social;
      if (!social && domain.site_profile?.business?.name && (p as any).body_md && (p as any).title) {
        social = await runSocialAdapter({ title: (p as any).title, body_md: (p as any).body_md }, domain.site_profile);
        await sb.from('posts').update({ social }).eq('id', p.id);
      }
      const res = await publishToSocials(
        (p as any).domain_id,
        {
          id: (p as any).id, title: (p as any).title, slug: (p as any).slug,
          social, cover_image_url: (p as any).cover_image_url, social_published: (p as any).social_published,
        },
        {
          blog_slug: domain.blog_slug,
          canonical_blog_base: domain.canonical_blog_base,
          custom_blog_hostname: domain.custom_blog_hostname,
          social_webhook_url: domain.social_webhook_url,
          social_webhook_secret: domain.social_webhook_secret,
        },
      );
      if (Object.values(res).some((r: any) => r?.id)) socialFanout++;
    } catch (e) {
      console.error('[social fanout]', (p as any).id, e);
    }
  }

  // 1b) RECLAIM stranded generations. A post that was mid-flight when the
  //     platform killed the function (timeout, deploy, OOM) is left in a
  //     working status, which the drain skips — so its plan slot was silently
  //     lost forever and only a manual retry could recover it. Time-boxing the
  //     drain makes clean stops the norm, but kills still happen; put anything
  //     abandoned back in the queue. generate.ts resumes from persisted
  //     research/draft, so a reclaim is cheap rather than a full redo.
  let reclaimed = 0;
  const { data: working } = await sb
    .from('posts')
    .select('id, generation_log')
    .in('status', WORKING_STATUSES)
    .limit(100);
  for (const p of working ?? []) {
    if (!isStranded((p as any).generation_log, Date.now())) continue;
    const { data: back } = await sb
      .from('posts')
      .update({ status: 'queued' })
      .eq('id', (p as any).id)
      .in('status', WORKING_STATUSES)
      .select('id')
      .maybeSingle();
    if (back) reclaimed++;
  }

  // Generation (strategy builds, drafting) is paid-only: resolve the verified
  // domains and which of their owners hold a live subscription, once per tick.
  const { data: verified } = await sb
    .from('domains')
    .select('id, hostname, posts_per_week, site_profile, interview, user_id')
    .not('verified_at', 'is', null)
    .order('created_at', { ascending: true });
  const entitled = await entitledUserSet((verified ?? []).map((d: any) => d.user_id));
  const entitledDomains = (verified ?? []).filter((d: any) => entitled.has(d.user_id));
  const entitledDomainIds = new Set(entitledDomains.map((d: any) => d.id));
  // Quota is per SUBSCRIPTION, and a plan's post allowance is shared across all
  // of that owner's domains — so it's tracked per user, not per domain.
  const ownerOf = new Map<string, string>(entitledDomains.map((d: any) => [d.id, d.user_id]));
  const quotas = await quotaForUsers(entitledDomains.map((d: any) => d.user_id));
  const hasRoomInPlan = (userId: string | undefined) => {
    if (!userId) return false;
    const q = quotas.get(userId);
    return q ? !q.exhausted : true; // unknown subscription → don't throttle
  };

  // 2) drain sizing: measure what a generation actually costs right now from the
  //    logs of recently finished posts, rather than assuming. The estimate is
  //    pessimistic (p80) so we under-fill instead of getting killed mid-article.
  const { data: recent } = await sb
    .from('posts')
    .select('generation_log')
    .in('status', ['published', 'scheduled', 'review'])
    .order('created_at', { ascending: false })
    .limit(DURATION_SAMPLE_SIZE);
  const samples = (recent ?? [])
    .map((r: any) => generationDurationMs(r.generation_log))
    .filter((n): n is number => n !== null);
  const estimateMs = estimateGenerationMs(samples);
  // The drain must leave the tail phases (Search Console) room to run.
  const drainBudgetMs = Math.max(0, budgetMs - GSC_RESERVE_MS);

  // 2b) SELF-HEAL the monthly strategy: if the run on the 1st was killed (LLM
  //     timeout, platform limit), the loop used to stay dead until the NEXT 1st
  //     — no re-evaluation, no new slots, no new posts. Build at most one
  //     missing current-month strategy per tick, and only when doing so still
  //     leaves room to generate something afterwards.
  let strategyHealed = 0;
  const monthDate = monthBounds().thisMonth.toISOString().slice(0, 10);
  const { data: haveStrategy } = await sb
    .from('strategies').select('domain_id')
    .eq('month', monthDate).eq('active', true);
  const covered = new Set((haveStrategy ?? []).map((r: any) => r.domain_id));
  const missing = entitledDomains.find(
    (d: any) => !covered.has(d.id) && d.site_profile?.business?.name,
  );
  const healBudgetMs = 120_000;
  if (missing && hasRoomFor(elapsed(), drainBudgetMs, healBudgetMs + estimateMs)) {
    try {
      const res = await ensureMonthlyStrategy(missing as EnsureDomain, { llmTimeoutMs: healBudgetMs });
      if (res === 'created') strategyHealed = 1;
    } catch (e) {
      console.error('[scheduler] strategy self-heal failed:', (missing as any).id, e);
    }
  }

  // 2c) materialize plan → posts: turn active-strategy slots that are due
  //     (within the lead window) into queued posts, carrying their planned
  //     publish date through. This is what actually executes the strategy.
  let materialized = 0;
  for (const d of entitledDomains) {
    // Don't queue work the plan can't pay for — it would just accumulate
    // undrainable rows until the cycle rolls over.
    if (!hasRoomInPlan((d as any).user_id)) continue;
    try {
      const ids = await materializeDuePlanSlots(d.id, { leadHours: 72, limit: 3 });
      materialized += ids.length;
    } catch { /* one domain failing must not stall the tick */ }
  }

  // 3) drain queued posts for as long as this invocation has room.
  //    pickQueuedFairly round-robins across domains (one each, oldest-waiting
  //    domain first, leftovers top up) so one customer's deep backlog can't
  //    monopolize the tick. Posts whose owner isn't paying stay queued
  //    untouched — they resume if the account upgrades, and they never starve
  //    paying accounts (we scan past them rather than counting them).
  const { data: queuedAll } = await sb
    .from('posts').select('id, domain_id, created_at').eq('status', 'queued')
    .order('created_at', { ascending: true }).limit(200);
  const entitledQueued = (queuedAll ?? []).filter((p: any) => entitledDomainIds.has(p.domain_id));
  const candidates = pickQueuedFairly(entitledQueued as any[], MAX_POSTS_PER_TICK);

  let generated = 0;
  let deferred = 0;
  let overQuota = 0;
  const exhaustedOwners = new Set<string>();
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    // The first candidate always gets a go: at the top of a tick the whole
    // budget is unspent, so declining to start anything would waste the entire
    // invocation. That also means a bad duration estimate can only ever cost
    // throughput, never halt the loop outright — the failure mode that a
    // mis-measured estimate caused once already.
    if (generated > 0 && !hasRoomFor(elapsed(), drainBudgetMs, estimateMs)) {
      // Out of time — everything still untouched stays queued and leads the
      // next tick (pickQueuedFairly's ordering rotates who goes first).
      deferred = candidates.length - i;
      break;
    }
    // Skip owners already known to be out of plan this tick, so a customer with
    // a deep queue isn't claimed and un-claimed once per candidate.
    const ownerId = ownerOf.get(p.domain_id);
    if (ownerId && exhaustedOwners.has(ownerId)) { overQuota++; continue; }

    // Claim atomically. Ticks can overlap once the cron runs more often than a
    // generation takes; the conditional update means only one of them wins a
    // given post, and the seeded log timestamps the claim so a kill mid-run is
    // recognisable as stranded rather than active.
    const { data: claimed } = await sb
      .from('posts')
      .update({ status: 'researching', generation_log: seedLog() })
      .eq('id', p.id)
      .eq('status', 'queued')
      .select('id')
      .maybeSingle();
    if (!claimed) continue; // another tick (or a manual run) took it

    // Reserve against the owner's plan. Claimed-but-unaffordable goes straight
    // back to the queue so it's picked up once the cycle rolls over.
    const reserved = ownerId ? await consumeQuota(ownerId) : { ok: true };
    if (!reserved.ok) {
      await sb.from('posts').update({ status: 'queued' }).eq('id', p.id);
      if (ownerId) exhaustedOwners.add(ownerId);
      overQuota++;
      continue;
    }

    try {
      await generatePost(p.id);
      generated++;
    } catch (e: any) {
      if (ownerId) await releaseQuota(ownerId);
      await sb.from('posts').update({ status: 'failed', validation: { error: String(e?.message ?? e) } }).eq('id', p.id);
    }
  }

  // NOTE: cover + inline image backfill lives in its own cron (/api/cron/images)
  // now — it was being starved here by the generation drain above. This tick
  // stays focused on strategy → generation → publishing.

  // 4) refresh Search Console snapshots for connected domains. This is the
  //    loop's real-world feedback signal — impressions/position per page —
  //    that the strategist reads on its next monthly planning call. It runs in
  //    the budget the drain was told to leave alone, so a deep queue can no
  //    longer starve it.
  let gscSynced = 0;
  const { data: gscDomains } = await sb
    .from('domains').select('id').not('gsc_refresh_token', 'is', null);
  for (const d of gscDomains ?? []) {
    if (elapsed() >= budgetMs) break;
    try {
      const res = await syncDomain(d.id);
      if (res.ok) gscSynced++;
    } catch { /* a GSC outage must not stall the tick */ }
  }

  return NextResponse.json({
    published: due?.length ?? 0,
    social_fanout: socialFanout,
    reclaimed,
    strategy_healed: strategyHealed,
    materialized,
    generated,
    deferred,
    over_quota: overQuota,
    gsc_synced: gscSynced,
    // Telemetry for capacity planning — how this tick sized itself.
    capacity: {
      ticks_per_day: schedulerTicksPerDay(),
      budget_ms: budgetMs,
      estimate_ms: estimateMs,
      samples: samples.length,
      elapsed_ms: elapsed(),
      queue_depth: entitledQueued.length,
    },
  });
}
