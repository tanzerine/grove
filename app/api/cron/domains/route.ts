/**
 * GET /api/cron/domains — nightly reconcile of the two things about a customer's
 * blog that drift on their own: where it is served from, and what it looks like.
 *
 * 1. HOSTNAMES. Enrollment attaches the hostname synchronously
 *    (app/api/domains/settings), but that single call can miss: a transient
 *    Vercel error, a token rotated after the row was saved, or a hostname
 *    imported straight into the DB. This pass re-attaches every
 *    domains.custom_blog_hostname idempotently, so a host that isn't routed yet
 *    gets picked up within a day without anyone noticing.
 *
 *    attachProjectDomain is idempotent (an already-attached host resolves to
 *    'already_attached'), so running this every night causes no churn.
 *
 * 2. DESIGN. `site_profile.design` is what makes a hosted blog wear the
 *    customer's clothes (lib/site-design). Its only writer used to be the
 *    generation pipeline, which meant a domain that publishes rarely could stay
 *    uncaptured indefinitely — grove's own blog sat on a null design for as
 *    long as the feature had shipped, rendering in the old paper skin while the
 *    marketing site next to it was black. A capture is one homepage fetch plus
 *    its stylesheets, so it belongs on a schedule, and on a REFRESH schedule
 *    rather than a backfill: sites get redesigned, and a blog that keeps
 *    wearing last year's palette is the same bug arriving slowly.
 *
 * Guarded by CRON_SECRET — Vercel sends it as a Bearer token automatically.
 * The hostname half degrades to a no-op when the Vercel env is unset, and the
 * design half runs regardless — they share a schedule, not a dependency.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { attachProjectDomain, isVercelDomainsConfigured } from '@/lib/vercel/domains';
import { captureSiteDesign, type SiteProfile } from '@/lib/pipeline/site-profile';
import { hasDesign } from '@/lib/site-design';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Captures per run. A capture is ~1–3s of network, so this is a wall-clock cap
 * on the design half, leaving the rest of the budget to the hostname pass. At
 * one run a day it also sets the refresh cadence: a fleet under this size is
 * re-captured daily, a larger one rotates through oldest-first.
 */
const DESIGN_REFRESH_LIMIT = 25;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();

  // ── 1. hostnames ───────────────────────────────────────────────────────────
  let hostnames: Record<string, unknown> = { skipped: 'vercel not configured' };

  if (isVercelDomainsConfigured()) {
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

    hostnames = {
      total: hosts.length,
      attached,
      verified,
      pending: attached - verified, // routed but DNS/TLS not confirmed yet
      errors,
    };
  }

  // ── 2. design ──────────────────────────────────────────────────────────────
  const design = await refreshDesigns(sb);

  return NextResponse.json({ ok: true, hostnames, design });
}

/**
 * Re-capture `site_profile.design` for the domains whose capture is oldest or
 * missing.
 *
 * Two rules keep this from making a blog worse than it already is:
 *  - a capture that yields nothing (`hasDesign` false) is never written, so a
 *    homepage that is briefly down or newly behind a bot wall cannot erase a
 *    good capture and drop the blog back to grove's palette;
 *  - the row is re-read and merged rather than overwritten, so a profile
 *    rewritten by a generation running at the same time keeps its own fields.
 */
async function refreshDesigns(sb: ReturnType<typeof supabaseAdmin>) {
  const { data: rows } = await sb
    .from('domains')
    .select('id,hostname,site_profile')
    .not('site_profile', 'is', null)
    .limit(1000);

  // Never captured first, then oldest capture first. Both halves of the sort
  // matter: the first is the backfill, the second is what makes it a refresh.
  const queue = (rows ?? [])
    .filter((r) => (r.site_profile as SiteProfile | null)?.business?.name)
    .sort((a, b) => {
      const at = (a.site_profile as SiteProfile)?.design_captured_at ?? '';
      const bt = (b.site_profile as SiteProfile)?.design_captured_at ?? '';
      return at < bt ? -1 : at > bt ? 1 : 0;
    })
    .slice(0, DESIGN_REFRESH_LIMIT);

  let captured = 0;
  let empty = 0;
  const errors: { host: string; message: string }[] = [];

  for (const row of queue) {
    try {
      const d = await captureSiteDesign(row.hostname as string);
      if (!hasDesign(d)) { empty++; continue; }

      const { data: fresh } = await sb.from('domains').select('site_profile').eq('id', row.id).single();
      const profile = (fresh?.site_profile ?? row.site_profile) as SiteProfile;
      await sb
        .from('domains')
        .update({ site_profile: { ...profile, design: d, design_captured_at: new Date().toISOString() } })
        .eq('id', row.id);
      captured++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ host: row.hostname as string, message });
      console.error('[cron/domains] design', row.hostname, message);
    }
  }

  return { considered: queue.length, captured, empty, errors };
}
