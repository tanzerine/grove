/**
 * The core loop, run on the schedule in vercel.json:
 *   1. publish any 'scheduled' posts whose time has come (+ social fanout)
 *   2. reclaim generations the platform killed mid-flight
 *   3. self-heal the monthly strategy, materialize due plan slots
 *   4. drain the 'queued' bucket by generating drafts
 *   5. refresh Search Console snapshots
 *
 * A freshly generated draft gets its cover in step 4, right after it's written,
 * whenever the tick can still afford one — otherwise the owner opens a
 * just-finished draft and finds it blank until the next image cron. The
 * BACKFILL (covers that didn't fit, inline images) still lives in its own cron
 * (/api/cron/images) so it isn't starved by the generation drain.
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
 * — so the move from daily to hourly (once the account reached Vercel Pro, which
 * rejects sub-daily crons on Hobby) multiplied throughput ~24x without touching
 * this file. lib/pipeline/capacity holds the arithmetic and reports deliverable
 * capacity against sold quota so overselling surfaces on the admin overview
 * instead of as silent under-delivery.
 *
 * Phases that don't need every tick say so: the Search Console sync runs on one
 * tick a day (Google reports daily), which hands its reserve back to generation
 * on the other 23.
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
import { runCoverForPost } from '@/lib/pipeline/cover-image';
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
  shouldSyncGsc,
} from '@/lib/pipeline/capacity';
import { materializeDuePlanSlots } from '@/lib/strategy/materialize';
import { entitledUserSet } from '@/lib/billing';
import { consumeQuota, quotaForUsers, releaseQuota, shareAllowance } from '@/lib/quota';
import { publishToSocials } from '@/lib/social/publish';
import { syncDomain } from '@/lib/search-console/sync';

export const maxDuration = 300;

/** Sampled from recent finished posts to size the drain. */
const DURATION_SAMPLE_SIZE = 20;

/** Ceiling on how many plan slots one domain may turn into posts in one tick,
 *  so a single tick can't materialize a whole month of a plan at once. */
const MATERIALIZE_PER_TICK = 3;

/**
 * Wall-clock to reserve for one inline cover before starting it.
 *
 * A cover is an LLM art-direction call plus an image render plus an upload —
 * measured at roughly a minute, with internal retries that can push it further.
 * Budgeting generously means a tight tick simply skips the cover and leaves it
 * to /api/cron/images, which is the correct trade: the article is already
 * written and saved, and overrunning here would cost the NEXT article instead.
 */
const COVER_COST_MS = 75_000;

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
  // Only the tick that will actually sync Search Console has to hold budget
  // back for it — the other 23 spend the whole invocation on generation.
  const syncGsc = shouldSyncGsc(new Date(), schedulerTicksPerDay());
  const drainBudgetMs = Math.max(0, budgetMs - (syncGsc ? GSC_RESERVE_MS : 0));

  // 2b) Strategy self-heal used to live here, squeezed into a 120s slice of
  //     this tick. That slice was below strategyLlmCall's minimum budget, so
  //     every heal silently planned on the workhorse instead of the strategy
  //     model — the tier was effectively off for all automated builds.
  //
  //     It now has its own cron (/api/cron/strategy, hourly at :45) with the
  //     whole invocation to itself, which is the only way the planner gets the
  //     ~3-4 minutes it needs. Healing still happens every hour; it just no
  //     longer competes with the drain, and this tick keeps its full budget for
  //     generation.

  // 2c) materialize plan → posts: turn active-strategy slots that are due
  //     (within the lead window) into queued posts, carrying their planned
  //     publish date through. This is what actually executes the strategy.
  let materialized = 0;

  // What each owner has already committed: posts planned but not yet generated.
  // `remaining` only falls when a post is GENERATED, so without subtracting
  // this the loop re-plans against the same allowance every tick and the queue
  // grows past anything the plan can pay for.
  const { data: pendingQueued } = await sb
    .from('posts').select('domain_id').eq('status', 'queued').limit(500);
  const queuedByOwner = new Map<string, number>();
  for (const p of pendingQueued ?? []) {
    const owner = ownerOf.get((p as any).domain_id);
    if (owner) queuedByOwner.set(owner, (queuedByOwner.get(owner) ?? 0) + 1);
  }

  // Divide each owner's remaining allowance across THEIR domains. The allowance
  // is per subscription; planning is per domain. Gating on a bare "is this owner
  // exhausted?" let whichever domain came first spend the whole plan.
  const domainsByOwner = new Map<string, string[]>();
  for (const d of entitledDomains) {
    const owner = (d as any).user_id;
    const list = domainsByOwner.get(owner) ?? [];
    list.push(d.id);
    domainsByOwner.set(owner, list);
  }
  const planBudget = new Map<string, number>();
  for (const [owner, ids] of domainsByOwner) {
    const q = quotas.get(owner);
    const shares = shareAllowance({
      remaining: q ? q.remaining : Infinity,   // unknown subscription → don't throttle
      alreadyQueued: queuedByOwner.get(owner) ?? 0,
      domainIds: ids,
      perDomainCap: MATERIALIZE_PER_TICK,
    });
    for (const [id, n] of shares) planBudget.set(id, n);
  }

  for (const d of entitledDomains) {
    // Don't queue work the plan can't pay for — it would just accumulate
    // undrainable rows until the cycle rolls over.
    const allowed = planBudget.get(d.id) ?? 0;
    if (allowed <= 0) continue;
    try {
      const ids = await materializeDuePlanSlots(d.id, { leadHours: 72, limit: allowed });
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
  let coversInline = 0;
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
      // Give the fresh draft its cover NOW if there's room for one. Covers were
      // left entirely to /api/cron/images, which runs on the half hour, so an
      // autopilot draft reached `review` with no image and kept it for up to an
      // hour — the owner opening a just-finished draft always saw a blank one.
      //
      // Strictly best-effort: it runs only when the tick can afford it, and a
      // failure never touches the article, which is already written and saved.
      // Anything skipped here is exactly what the images cron is for.
      if (hasRoomFor(elapsed(), drainBudgetMs, COVER_COST_MS)) {
        try {
          await runCoverForPost(p.id);
          coversInline++;
        } catch (e) {
          console.error('[scheduler] inline cover failed:', p.id, e);
        }
      }
    } catch (e: any) {
      if (ownerId) await releaseQuota(ownerId);
      await sb.from('posts').update({ status: 'failed', validation: { error: String(e?.message ?? e) } }).eq('id', p.id);
    }
  }

  // NOTE: the cover BACKFILL still lives in its own cron (/api/cron/images) —
  // it was being starved here by the generation drain. What runs above is only
  // the just-generated post's own cover, when the tick has room; the cron
  // remains the safety net for everything that didn't fit.

  // 4) refresh Search Console snapshots for connected domains. This is the
  //    loop's real-world feedback signal — impressions/position per page —
  //    that the strategist reads on its next monthly planning call. It runs in
  //    the budget the drain was told to leave alone, so a deep queue can no
  //    longer starve it. Google reports at daily granularity, so this runs on
  //    one tick a day rather than on every one of them.
  let gscSynced = 0;
  if (syncGsc) {
    const { data: gscDomains } = await sb
      .from('domains').select('id').not('gsc_refresh_token', 'is', null);
    for (const d of gscDomains ?? []) {
      if (elapsed() >= budgetMs) break;
      try {
        const res = await syncDomain(d.id);
        if (res.ok) gscSynced++;
      } catch { /* a GSC outage must not stall the tick */ }
    }
  }

  return NextResponse.json({
    published: due?.length ?? 0,
    social_fanout: socialFanout,
    reclaimed,
    // strategy_healed moved to /api/cron/strategy — see 2b.
    materialized,
    generated,
    covers_inline: coversInline,
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
