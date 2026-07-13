/**
 * GET /api/cron/domains — nightly reconcile of customer CNAME'd blog hostnames
 * against the Vercel project.
 *
 * Enrollment attaches the hostname synchronously (app/api/domains/settings),
 * but that single call can miss: a transient Vercel error, a token rotated
 * after the row was saved, or a hostname imported straight into the DB. This
 * pass re-attaches every domains.custom_blog_hostname idempotently, so a host
 * that isn't routed yet gets picked up within a day without anyone noticing.
 *
 * attachProjectDomain is idempotent (an already-attached host resolves to
 * 'already_attached'), so running this every night causes no churn.
 *
 * Guarded by CRON_SECRET — Vercel sends it as a Bearer token automatically.
 * Degrades to a no-op when the Vercel env is unset (state:'skipped'), so it
 * still 200s in preview / local.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { attachProjectDomain, isVercelDomainsConfigured } from '@/lib/vercel/domains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (!isVercelDomainsConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'vercel not configured', reconciled: 0 });
  }

  const sb = supabaseAdmin();
  const { data: rows } = await sb
    .from('domains')
    .select('custom_blog_hostname')
    .not('custom_blog_hostname', 'is', null)
    .limit(1000);

  // de-dupe defensively (the unique index should already guarantee this)
  const hosts = Array.from(new Set((rows ?? []).map((r) => r.custom_blog_hostname as string).filter(Boolean)));

  let attached = 0;
  let verified = 0;
  const errors: { host: string; message: string }[] = [];

  for (const host of hosts) {
    const res = await attachProjectDomain(host);
    if (res.ok) {
      attached++;
      if (res.verified) verified++;
    } else if (res.state === 'error') {
      errors.push({ host, message: res.message });
      console.error('[cron/domains]', host, res.message);
    }
  }

  return NextResponse.json({
    ok: true,
    total: hosts.length,
    attached,
    verified,
    pending: attached - verified, // routed but DNS/TLS not confirmed yet
    errors,
  });
}
