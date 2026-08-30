/**
 * GET /api/cron/weekly-digest — runs weekly (Monday morning).
 *
 * Two jobs per verified domain:
 *
 *  1. PROGRESS TRACKING (every domain): compute the week's numbers and how
 *     they compare to the plan, and append one compact entry to the domain's
 *     rolling progress log (agent_context.progress_md). This is the weekly
 *     heartbeat of the loop — the monthly strategist reads this log, so the
 *     plan actually learns from the season instead of only month-end totals.
 *
 *  2. DIGEST EMAIL (opt-in via domains.weekly_digest): the same plain-English
 *     brief, emailed to the owner via Resend.
 *
 * Owner email comes from the auth user that owns the domain
 * (domains.user_id → auth.users) via the service-role admin client.
 *
 * Guarded by CRON_SECRET — Vercel sends it as a Bearer token automatically.
 * Degrades gracefully: with no RESEND_API_KEY the sends are console.warn no-ops
 * (see lib/email/resend.ts) so the route still 200s in preview / local.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { getBriefStats } from '@/lib/agent-brief';
import { composeDigestEmail } from '@/lib/email/digest';
import { sendEmail } from '@/lib/email/resend';
import { progressEntry } from '@/lib/strategy/context';
import { appendWeeklyProgress } from '@/lib/strategy/context-store';
import type { PostSlot } from '@/lib/strategy/build';
import { normalizeLang } from '@/lib/language';
import type { UiLocale } from '@/lib/i18n';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://trygroveai.com';

  // All verified domains — progress tracking runs for everyone; the email
  // below additionally respects the weekly_digest opt-out.
  const { data: domains } = await sb
    .from('domains')
    .select('id, hostname, user_id, weekly_digest')
    .not('verified_at', 'is', null);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let logged = 0;
  const emailByUser = new Map<string, string | null>();
  const localeByUser = new Map<string, UiLocale>();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);

  for (const d of domains ?? []) {
    let stats: Awaited<ReturnType<typeof getBriefStats>> | null = null;
    try {
      stats = await getBriefStats(d.id, d.hostname);

      // How many slots did the plan want live in this window?
      const { data: strat } = await sb
        .from('strategies').select('publishing_plan')
        .eq('domain_id', d.id).eq('active', true)
        .order('month', { ascending: false }).limit(1).maybeSingle();
      const planned = (((strat as any)?.publishing_plan ?? []) as PostSlot[])
        .filter((s) => s.publish_date
          && s.publish_date >= weekAgo.toISOString()
          && s.publish_date < now.toISOString()).length;

      await appendWeeklyProgress(d.id, progressEntry({
        weekOf: weekAgo.toISOString().slice(0, 10),
        published: stats.publishedThisWeek,
        planned,
        reads: stats.readsThisWeek,
        readsPrev: stats.readsLastWeek,
        conversions: stats.conversionsThisWeek,
        organicShare: stats.organicShare,
        topPost: stats.topPost,
      }));
      logged++;
    } catch (e) {
      console.error('[weekly-progress]', d.hostname, e);
    }

    if (!d.weekly_digest) { continue; }
    try {
      // Resolve owner email (cache per user — one owner may hold many domains).
      let email = emailByUser.get(d.user_id);
      if (email === undefined) {
        const { data: u } = await sb.auth.admin.getUserById(d.user_id);
        email = u?.user?.email ?? null;
        emailByUser.set(d.user_id, email);
        // The same lookup carries the owner's UI language, so writing to them
        // in their own language costs nothing extra here.
        localeByUser.set(d.user_id, normalizeLang((u?.user?.user_metadata as any)?.ui_language));
      }
      if (!email) { skipped++; continue; }

      if (!stats) stats = await getBriefStats(d.id, d.hostname);
      const { subject, html, text } = composeDigestEmail(stats, baseUrl, localeByUser.get(d.user_id) ?? 'en');
      const res = await sendEmail({ to: email, subject, html, text });

      if ('id' in res) sent++;
      else if ('skipped' in res) skipped++;
      else { failed++; console.error('[weekly-digest]', d.hostname, res.error); }
    } catch (e) {
      failed++;
      console.error('[weekly-digest]', d.hostname, e);
    }
  }

  return NextResponse.json({ domains: domains?.length ?? 0, logged, sent, skipped, failed });
}
