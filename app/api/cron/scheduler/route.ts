/**
 * Daily cron — runs the core loop:
 *   1. publish any 'scheduled' posts whose time has come (+ social fanout)
 *   2. self-heal the monthly strategy, materialize due plan slots
 *   3. drain the 'queued' bucket by generating drafts
 *   4. refresh Search Console snapshots
 *
 * Cover + inline image backfill lives in its own cron (/api/cron/images) so it
 * isn't starved by the generation drain above.
 *
 * Guarded by CRON_SECRET — Vercel sends it as a Bearer token automatically.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { generatePost } from '@/lib/pipeline/generate';
import { runSocialAdapter } from '@/lib/pipeline/writer';
import { materializeDuePlanSlots } from '@/lib/strategy/materialize';
import { ensureMonthlyStrategy, monthBounds, type EnsureDomain } from '@/lib/strategy/ensure';
import { entitledUserSet } from '@/lib/billing';
import { publishToSocials } from '@/lib/social/publish';
import { syncDomain } from '@/lib/search-console/sync';

export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();

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

  // 1b-pre) SELF-HEAL the monthly strategy: if the run on the 1st was killed
  //     (LLM timeout, platform limit), the loop used to stay dead until the
  //     NEXT 1st — no re-evaluation, no new slots, no new posts. Build at most
  //     one missing current-month strategy per daily tick instead.
  let strategyHealed = 0;
  const monthDate = monthBounds().thisMonth.toISOString().slice(0, 10);
  const { data: haveStrategy } = await sb
    .from('strategies').select('domain_id')
    .eq('month', monthDate).eq('active', true);
  const covered = new Set((haveStrategy ?? []).map((r: any) => r.domain_id));
  const missing = entitledDomains.find(
    (d: any) => !covered.has(d.id) && d.site_profile?.business?.name,
  );
  if (missing) {
    try {
      const res = await ensureMonthlyStrategy(missing as EnsureDomain, { llmTimeoutMs: 120_000 });
      if (res === 'created') strategyHealed = 1;
    } catch (e) {
      console.error('[scheduler] strategy self-heal failed:', (missing as any).id, e);
    }
  }

  // 1b) materialize plan → posts: turn active-strategy slots that are due
  //     (within the lead window) into queued posts, carrying their planned
  //     publish date through. This is what actually executes the strategy.
  let materialized = 0;
  for (const d of entitledDomains) {
    try {
      const ids = await materializeDuePlanSlots(d.id, { leadHours: 72, limit: 3 });
      materialized += ids.length;
    } catch { /* one domain failing must not stall the tick */ }
  }

  // 2) drain queued posts (limit 3 per tick to stay under Vercel 300s).
  //    Posts whose owner isn't paying stay queued untouched — they resume if
  //    the account upgrades, and they never starve paying accounts (we scan
  //    past them rather than counting them against the limit).
  const { data: queuedAll } = await sb
    .from('posts').select('id, domain_id').eq('status', 'queued').limit(30);
  const queued = (queuedAll ?? []).filter((p: any) => entitledDomainIds.has(p.domain_id)).slice(0, 3);

  for (const p of queued ?? []) {
    try {
      await generatePost(p.id);
    } catch (e: any) {
      await sb.from('posts').update({ status: 'failed', validation: { error: String(e?.message ?? e) } }).eq('id', p.id);
    }
  }

  // NOTE: cover + inline image backfill lives in its own cron (/api/cron/images)
  // now — it was being starved here by the generation drain above. This tick
  // stays focused on strategy → generation → publishing.

  // 5) refresh Search Console snapshots for connected domains. This is the
  //    loop's real-world feedback signal — impressions/position per page —
  //    that the strategist reads on its next monthly planning call.
  let gscSynced = 0;
  const { data: gscDomains } = await sb
    .from('domains').select('id').not('gsc_refresh_token', 'is', null);
  for (const d of gscDomains ?? []) {
    try {
      const res = await syncDomain(d.id);
      if (res.ok) gscSynced++;
    } catch { /* a GSC outage must not stall the tick */ }
  }

  return NextResponse.json({
    published: due?.length ?? 0,
    social_fanout: socialFanout,
    strategy_healed: strategyHealed,
    materialized,
    generated: queued?.length ?? 0,
    gsc_synced: gscSynced,
  });
}
