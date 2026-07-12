/**
 * GET /api/cron/admin-digest — daily (08:00 KST = 23:00 UTC).
 *
 * Emails the owner a business snapshot (new signups, MRR, active subs, refund
 * queue, referral mix) plus any anomaly flags from the last hour, so they can
 * track the business and catch abnormal activity without opening Supabase.
 *
 * Guarded by CRON_SECRET (Vercel sends it as a Bearer token). Degrades
 * gracefully: with no RESEND_API_KEY the send is a logged no-op.
 */
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { getAdminStats } from '@/lib/admin-stats';
import { detectAnomalies } from '@/lib/anomaly';
import { composeAdminDigestEmail } from '@/lib/email/admin-digest';
import { sendEmail } from '@/lib/email/resend';
import { ownerNotifyEmail } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://trygroveai.com';

  const [stats, flags] = await Promise.all([getAdminStats(), detectAnomalies()]);
  const { subject, html, text } = composeAdminDigestEmail(stats, flags, baseUrl);
  const res = await sendEmail({ to: ownerNotifyEmail(), subject, html, text });

  return NextResponse.json({
    ok: true,
    flags: flags.length,
    critical: flags.filter((f) => f.severity === 'critical').length,
    emailed: 'id' in res,
  });
}
