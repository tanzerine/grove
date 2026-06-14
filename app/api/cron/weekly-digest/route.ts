/**
 * GET /api/cron/weekly-digest — runs weekly (Monday morning).
 *
 * The retention loop on top of the dashboard's agent brief: for every verified
 * domain that hasn't opted out (domains.weekly_digest), compose the same
 * plain-English report and email it to the domain owner via Resend.
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://grove.so';

  // Verified domains that haven't opted out of the digest.
  const { data: domains } = await sb
    .from('domains')
    .select('id, hostname, user_id, weekly_digest')
    .not('verified_at', 'is', null)
    .eq('weekly_digest', true);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const emailByUser = new Map<string, string | null>();

  for (const d of domains ?? []) {
    try {
      // Resolve owner email (cache per user — one owner may hold many domains).
      let email = emailByUser.get(d.user_id);
      if (email === undefined) {
        const { data: u } = await sb.auth.admin.getUserById(d.user_id);
        email = u?.user?.email ?? null;
        emailByUser.set(d.user_id, email);
      }
      if (!email) { skipped++; continue; }

      const stats = await getBriefStats(d.id, d.hostname);
      const { subject, html, text } = composeDigestEmail(stats, baseUrl);
      const res = await sendEmail({ to: email, subject, html, text });

      if ('id' in res) sent++;
      else if ('skipped' in res) skipped++;
      else { failed++; console.error('[weekly-digest]', d.hostname, res.error); }
    } catch (e) {
      failed++;
      console.error('[weekly-digest]', d.hostname, e);
    }
  }

  return NextResponse.json({ domains: domains?.length ?? 0, sent, skipped, failed });
}
