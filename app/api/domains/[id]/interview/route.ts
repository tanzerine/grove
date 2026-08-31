/**
 * POST /api/domains/[id]/interview
 *
 * Saves owner interview answers and builds this month's strategy on the spot,
 * so the owner lands on /dashboard/strategy with a real plan.
 *
 * Answering these five questions IS the request for a plan, so the build is
 * unconditional for a verified domain: no site profile (a crawl that failed, a
 * site that isn't up yet) falls back to planning from the answers alone rather
 * than leaving the owner to wait for the 1st of next month. If the strategist
 * itself fails, the response says so and /dashboard/strategy offers a retry.
 *
 * Idempotent: re-saving updates the row + replaces the active strategy for
 * this month (the system trusts the latest owner intent).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ensureMonthlyStrategy } from '@/lib/strategy/ensure';
import { profileSite, type SiteProfile } from '@/lib/pipeline/site-profile';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { getUiLocale } from '@/lib/i18n/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const body = z.object({
  answers: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  skip: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // This route runs an outbound crawl and a strategy LLM call, so it is
  // cost-bearing and gets the same ceiling as the other crawl endpoints. It was
  // the only one of them with no limiter at all.
  const limited = await enforceRateLimit(`interview:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  // ownership check + load profile in one shot
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, posts_per_week, site_profile, verified_at, language')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const answers = parsed.data.skip ? null : parsed.data.answers;
  const { error: updErr } = await sb
    .from('domains')
    .update({ interview: answers })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 });

  // Everything above is a cheap write and stays open: the interview is part of
  // onboarding, and losing someone's typed answers because of a gate would be
  // worse than the gate is worth.
  //
  // Everything below crawls the customer's site and runs the strategist, so it
  // requires a VERIFIED domain. Ownership is the check that matters here: the
  // hostname is attacker-chosen and nothing else on this path constrained it, so
  // an account could point Grove's crawler at any third party and burn LLM spend
  // on it. (Production had a full 17-slot strategy built for `google.com` this
  // way.) Verification is already step 4 of onboarding, so a real customer has
  // always passed it by the time they answer these questions — only the
  // "Skip for now" path lands here unverified, and that path has nothing to
  // legitimately generate yet.
  if (!(domain as any).verified_at) {
    return NextResponse.json({ ok: true, strategy_built: false, reason: 'unverified' });
  }

  // Build this month's plan now. Answering these questions IS the owner asking
  // for a plan, so it must not end with them on an empty strategy page being
  // told to wait for the 1st — the failure is reported back instead, and the
  // page offers to try again.
  let strategyBuilt = false;
  let reason: string | undefined;
  try {
    const admin = supabaseAdmin();
    let profile = (domain as any).site_profile as SiteProfile | null;

    // The profile is crawled fire-and-forget after verification, so on a fresh
    // signup it's usually NOT ready yet by the time the owner finishes the
    // interview. Crawl it here, synchronously, so the first plan is grounded in
    // their real site — but a crawl that fails is no longer fatal (below).
    if (!profile?.business?.name) {
      try {
        const built = await profileSite((domain as any).hostname);
        if (built?.business?.name) {
          profile = built;
          await admin.from('domains').update({ site_profile: built }).eq('id', id);
        }
      } catch (e) {
        console.error('[interview] profileSite failed:', e);
      }
    }

    // One builder for every path that produces a month's plan (this route, the
    // monthly cron, the scheduler's self-heal), so they can't drift.
    //
    // `profileFallback` is what makes this unconditional: a crawl that failed
    // used to mean no strategy at all, which left the owner exactly where this
    // bug was reported from — five questions answered, nothing to show, and a
    // month to wait. Their answers are the intent that matters; plan from those.
    // `replaceActive` because re-answering means the latest intent wins.
    const result = await ensureMonthlyStrategy(
      {
        id,
        hostname: (domain as any).hostname,
        posts_per_week: (domain as any).posts_per_week ?? null,
        site_profile: profile,
        interview: answers,
        user_id: user.id,
        language: (domain as any).language,
      },
      {
        replaceActive: true, profileFallback: true, budgetMs: maxDuration * 1000,
        // A request has a signed-in owner, so the plan's commentary can be
        // written in the language they read grove in.
        uiLocale: await getUiLocale(),
      },
    );
    strategyBuilt = result === 'created';
    if (!strategyBuilt) reason = result;
  } catch (err) {
    console.error('[interview] strategy build failed:', err);
    // The owner's answers are saved either way — but say that it failed.
    reason = 'build_failed';
  }

  return NextResponse.json({ ok: true, strategy_built: strategyBuilt, ...(reason ? { reason } : {}) });
}
