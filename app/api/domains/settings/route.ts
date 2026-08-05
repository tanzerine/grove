import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { supabaseServer } from '@/lib/supabase/server';
import { isPublicHttpUrl } from '@/lib/net/ssrf';
import { normalizeCanonicalBase, normalizeBlogHostname, appBase } from '@/lib/seo';
import { deriveBrandColors } from '@/lib/blog-theme';
import { attachProjectDomain, detachProjectDomain, cnameHint, type DomainAttachResult } from '@/lib/vercel/domains';
import { getQuota } from '@/lib/quota';
import { canGenerateForUser } from '@/lib/billing';
import { maxPostsPerWeekForQuota } from '@/lib/plans';
import { canEnableAutopilot, REVIEWABLE_STATUSES } from '@/lib/autopilot-gate';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const schema = z.object({
  domain_id: z.string().uuid(),
  auto_publish: z.boolean().optional(),
  auto_social: z.boolean().optional(),
  posts_per_week: z.number().min(1).max(14).optional(),
  // autopilot quality bar: min manager score (0-100) to publish without a human.
  auto_publish_floor: z.number().int().min(0).max(100).optional(),
  // empty string clears the webhook; a URL sets it (https only).
  social_webhook_url: z.string().url().startsWith('https://').or(z.literal('')).optional(),
  // customer-hosted article base for canonical URLs; empty string clears it.
  canonical_blog_base: z.string().max(300).optional(),
  // customer-owned hostname CNAME'd at grove (blog.example.com); empty clears.
  custom_blog_hostname: z.string().max(200).optional(),
  // where the article-bottom "Try {business}" banner links; empty string
  // clears it (banner falls back to the homepage).
  cta_url: z.string().url().startsWith('https://').max(300).or(z.literal('')).optional(),
  // manual brand-color override. brand_primary === '' clears it (back to the
  // crawled palette); a hex sets it. brand_secondary is optional.
  brand_primary: z.string().regex(HEX).or(z.literal('')).optional(),
  brand_secondary: z.string().regex(HEX).optional(),
});

export async function PATCH(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { domain_id, ...updates } = parsed.data;
  const patch: Record<string, unknown> = { ...updates };

  // Cadence is capped by the plan's monthly allowance. Nothing stopped a
  // Starter account (12 posts/month) asking for 7/week — 30 planned slots the
  // drain would refuse as over-quota, so the calendar promised the customer
  // more than three times what they could actually be given. An allowance we
  // can't price (see lib/quota) isn't capped, same fail-open rule.
  if (updates.posts_per_week !== undefined) {
    // Only an account with a live plan has a cadence ceiling. Without one the
    // entitlement gate already blocks generation outright, and `posts_quota`
    // still holds the schema default of 4 — capping on that would tell someone
    // evaluating the product that "your plan includes 4 posts a month".
    const [{ limit }, entitled] = await Promise.all([
      getQuota(user.id, sb),
      canGenerateForUser(user.id, sb),
    ]);
    if (entitled && limit !== null) {
      const max = maxPostsPerWeekForQuota(limit);
      if (updates.posts_per_week > max) {
        return NextResponse.json(
          {
            error: 'cadence_over_plan',
            message: `Your plan includes ${limit} posts a month, which is up to ${max} a week. Upgrade to publish more often.`,
            max_posts_per_week: max,
          },
          { status: 400 },
        );
      }
    }
  }

  // Autopilot may not be armed before grove has shown this domain one finished
  // draft — see lib/autopilot-gate for why. Only the OFF → ON transition is
  // gated: re-saving a domain that already runs autopilot must never fail, and
  // turning it OFF is always allowed.
  if (updates.auto_publish === true) {
    const { data: row } = await sb
      .from('domains').select('auto_publish')
      .eq('id', domain_id).eq('user_id', user.id).maybeSingle();
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    if (!row.auto_publish) {
      const { count } = await sb
        .from('posts').select('id', { count: 'exact', head: true })
        .eq('domain_id', domain_id).in('status', REVIEWABLE_STATUSES as unknown as string[]);
      const gate = canEnableAutopilot({ finishedDrafts: count ?? 0 });
      if (!gate.allowed) {
        return NextResponse.json(
          { error: 'autopilot_needs_first_draft', message: gate.reason },
          { status: 409 },
        );
      }
    }
  }

  // Canonical base: normalize (force https shape, strip trailing slash) and
  // store null when cleared or unparseable — a garbage base must never leak
  // into canonical/sitemap/RSS URLs.
  if (updates.canonical_blog_base !== undefined) {
    const normalized = normalizeCanonicalBase(updates.canonical_blog_base);
    if (updates.canonical_blog_base.trim() !== '' && !normalized) {
      return NextResponse.json({ error: 'canonical base must be a valid URL like https://example.com/blog' }, { status: 400 });
    }
    patch.canonical_blog_base = normalized;
  }

  // CNAME'd blog hostname: normalize to a bare host and refuse footguns — the
  // app's own host (would shadow the product), any vercel.app host, and the
  // customer's site host itself (CNAME'ing that at grove takes their site down).
  // Capture attach/detach intent so the Vercel project is synced AFTER the DB
  // write commits (attach the new host, drop the old one on change/clear).
  let hostnameSync: { attach?: string; detach?: string } | null = null;
  if (updates.custom_blog_hostname !== undefined) {
    const { data: row } = await sb
      .from('domains').select('hostname, custom_blog_hostname')
      .eq('id', domain_id).eq('user_id', user.id).maybeSingle();
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const prev = (row.custom_blog_hostname as string | null) || null;

    if (updates.custom_blog_hostname.trim() === '') {
      patch.custom_blog_hostname = null;
      hostnameSync = prev ? { detach: prev } : null;
    } else {
      const host = normalizeBlogHostname(updates.custom_blog_hostname);
      if (!host) {
        return NextResponse.json({ error: 'must be a bare hostname like blog.example.com' }, { status: 400 });
      }
      let appHost = '';
      try { appHost = new URL(appBase()).hostname.toLowerCase(); } catch { /* keep '' */ }
      if (host === appHost || host === `www.${appHost}` || host.endsWith('.vercel.app')) {
        return NextResponse.json({ error: 'that hostname belongs to grove' }, { status: 400 });
      }
      const site = row.hostname.toLowerCase().replace(/^www\./, '');
      if (host === site || host === `www.${site}`) {
        return NextResponse.json(
          { error: `that's your site itself — use a subdomain like blog.${site}` },
          { status: 400 },
        );
      }
      patch.custom_blog_hostname = host;
      // re-attaching the same host is a harmless no-op; only detach a *different*
      // previous host so we don't yank one we're about to re-add.
      hostnameSync = { attach: host, detach: prev && prev !== host ? prev : undefined };
    }
  }

  // Banner link is a plain reader-facing href (never fetched server-side, so
  // no SSRF gate) — https is enforced by zod; empty clears back to homepage.
  if (updates.cta_url !== undefined) {
    patch.cta_url = updates.cta_url === '' ? null : updates.cta_url;
  }

  // Manual brand palette: derive the full BrandColors from the picked
  // primary/secondary (same path the crawler uses) so the stored override and a
  // crawled palette are shaped identically. Empty primary clears the override.
  if (updates.brand_primary !== undefined) {
    patch.brand_override = updates.brand_primary === ''
      ? null
      : deriveBrandColors(updates.brand_primary, { secondary: updates.brand_secondary });
  }
  // brand_secondary alone (primary unchanged) is meaningless — ignore it so a
  // stray field can't half-write an override.
  delete (patch as Record<string, unknown>).brand_primary;
  delete (patch as Record<string, unknown>).brand_secondary;

  // Webhook lifecycle: clearing the URL drops the secret too; setting a URL
  // mints a signing secret if the domain doesn't already have one.
  if (updates.social_webhook_url !== undefined) {
    if (updates.social_webhook_url === '') {
      patch.social_webhook_url = null;
      patch.social_webhook_secret = null;
    } else {
      // The cron POSTs to this URL server-side, so block targets that resolve
      // to internal/private addresses (SSRF). https is already enforced by zod.
      if (!(await isPublicHttpUrl(updates.social_webhook_url))) {
        return NextResponse.json({ error: 'webhook URL must be a public https endpoint' }, { status: 400 });
      }
      const { data: existing } = await sb
        .from('domains').select('social_webhook_secret')
        .eq('id', domain_id).eq('user_id', user.id).maybeSingle();
      if (!existing?.social_webhook_secret) {
        patch.social_webhook_secret = 'whsec_' + randomBytes(24).toString('hex');
      }
    }
  }

  const { error } = await sb.from('domains').update(patch).eq('id', domain_id).eq('user_id', user.id);
  if (error) {
    // unique index on custom_blog_hostname — surface it as a human sentence
    if (error.code === '23505') {
      return NextResponse.json({ error: 'that hostname is already connected to another blog' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ── Vercel sync (post-commit, best-effort) ────────────────────────────────
  // The row is saved; a Vercel outage must not fail the request. The client
  // never throws and returns {state:'skipped'} when unconfigured, so this is a
  // no-op in local/preview. We report the outcome so the UI can either confirm
  // auto-attach or fall back to the manual "add it in Vercel" instruction.
  let hostnameAttach: DomainAttachResult | undefined;
  if (hostnameSync?.detach) {
    await detachProjectDomain(hostnameSync.detach); // fire-and-forget cleanup
  }
  if (hostnameSync?.attach) {
    hostnameAttach = await attachProjectDomain(hostnameSync.attach);
  }

  return NextResponse.json({
    ok: true,
    ...(hostnameAttach
      ? {
          hostname_attach: {
            state: hostnameAttach.state, // attached | already_attached | skipped | error
            verified: hostnameAttach.ok ? hostnameAttach.verified : false,
            message: hostnameAttach.ok ? undefined : (hostnameAttach as any).message,
            cname: hostnameAttach.ok ? cnameHint(hostnameAttach) : undefined,
          },
        }
      : {}),
  });
}
