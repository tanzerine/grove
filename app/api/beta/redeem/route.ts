import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { captureServer } from '@/lib/analytics/capture-server';
import {
  normalizeCode,
  couponProblem,
  grantFor,
  betaStateFrom,
  hasLivePaidSubscription,
  COUPON_PROBLEM_MESSAGE,
  type CouponProblem,
} from '@/lib/beta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ code: z.string().min(1).max(64) });

/** One refusal shape, so the client never has to guess which field to read. */
function refuse(problem: CouponProblem, status = 400) {
  return NextResponse.json(
    { error: problem, message: COUPON_PROBLEM_MESSAGE[problem] },
    { status },
  );
}

/**
 * Redeem a free beta coupon.
 *
 * Grants a BOUNDED free run — N posts/month for N days (migration 0033) — not
 * the unmetered `comped` flag. Platform capacity is a fixed ~720 posts/month
 * across every account, so an unmetered guest spends a paying customer's share.
 *
 * Three invariants, each enforced by the database rather than by a check that
 * could lose a race:
 *
 *   one grant per account   → unique (user_id) on beta_redemptions
 *   never over-redeemed     → compare-and-swap on beta_coupons.redeemed_count
 *   codes are unguessable   → RLS with no policy (service-role reads only) plus
 *                             the tightest rate-limit bucket we have
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // A redeem endpoint is a guessing oracle — it takes a string and reports
  // whether that string is worth money. Throttled hard; see LIMITS.redeem.
  const limited = await enforceRateLimit(`betaredeem:${user.id}`, LIMITS.redeem);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const code = normalizeCode(parsed.data.code);
  if (!code) return refuse('unknown');

  const admin = supabaseAdmin();

  // ── who is asking ────────────────────────────────────────────────────────
  // `*` for the same reason lib/quota does it: a column this route reads but
  // the database hasn't got yet (0033, pre-migration) must not fail the query
  // and take redemption down with it.
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  // Already unmetered — nothing a coupon could add. Silently granting a beta
  // here would look like it worked and change nothing.
  if ((subRow as { comped?: boolean } | null)?.comped) {
    return NextResponse.json(
      { error: 'not_applicable', message: 'This account already has unlimited access.' },
      { status: 409 },
    );
  }

  // Already paying. Refuse loudly rather than granting a beta the readers would
  // ignore (a live subscription outranks a grant — see lib/beta precedence), and
  // point at the mechanism that DOES discount a paid plan: Stripe promotion
  // codes, which checkout already accepts.
  if (hasLivePaidSubscription(subRow)) {
    return NextResponse.json(
      {
        error: 'already_subscribed',
        message:
          "You're already on a paid plan, so a beta code would give you less, not more. If you have a discount code, enter it at checkout.",
      },
      { status: 409 },
    );
  }

  if (betaStateFrom(subRow).present) return refuse('already_redeemed', 409);

  // ── the code ─────────────────────────────────────────────────────────────
  const { data: coupon } = await admin
    .from('beta_coupons')
    .select('id, code, active, expires_at, max_redemptions, redeemed_count, posts_quota, days')
    .eq('code', code)
    .maybeSingle();

  const problem = couponProblem(coupon);
  if (problem) {
    await captureServer(user.id, 'beta_code_submitted', { ok: false, problem });
    return refuse(problem);
  }

  // ── reserve a redemption ─────────────────────────────────────────────────
  // Compare-and-swap, mirroring lib/quota's consumeQuota: check-then-increment
  // would let two people both pass the check on the last remaining redemption.
  // Whoever loses the swap re-reads and re-decides, so a coupon capped at 50
  // is redeemed 50 times and not 51.
  const reserved = await reserveRedemption(admin, coupon!.id);
  if (!reserved.ok) {
    await captureServer(user.id, 'beta_code_submitted', { ok: false, problem: reserved.problem });
    return refuse(reserved.problem);
  }

  const grant = grantFor(coupon!);

  // ── record it ────────────────────────────────────────────────────────────
  // The unique (user_id) index is the real mutex for "one grant per account";
  // the check above is only the friendly path. If two requests race past it,
  // this is what stops the second — and the reservation is handed back so a
  // lost race doesn't quietly burn one of the campaign's redemptions.
  const { error: redErr } = await admin.from('beta_redemptions').insert({
    coupon_id: coupon!.id,
    user_id: user.id,
    code: grant.code,
    posts_quota: grant.postsQuota,
    expires_at: grant.expiresAt,
    email: user.email ?? null,
  });

  if (redErr) {
    await releaseRedemption(admin, coupon!.id);
    // 23505 = unique_violation → this account already redeemed something.
    if (redErr.code === '23505') return refuse('already_redeemed', 409);
    console.error('[beta/redeem] redemption insert error:', redErr.message);
    return NextResponse.json({ error: 'could not redeem' }, { status: 500 });
  }

  // ── apply the grant ──────────────────────────────────────────────────────
  // Upsert, not update: handle_new_user() seeds a subscriptions row at signup,
  // but an account predating that trigger (or one whose seed failed) would
  // otherwise get a silent zero-row update — redemption recorded, access not
  // granted, and nothing to show for it.
  const { error: grantErr } = await admin.from('subscriptions').upsert(
    {
      user_id: user.id,
      beta_code: grant.code,
      beta_expires_at: grant.expiresAt,
      beta_posts_quota: grant.postsQuota,
      // A fresh allowance, so a grant isn't spent the moment it lands: the row
      // may already carry posts_used from a lapsed run, and metering a brand
      // new beta against it would hand someone an empty month.
      posts_used: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (grantErr) {
    console.error('[beta/redeem] grant error:', grantErr.message);
    return NextResponse.json({ error: 'could not redeem' }, { status: 500 });
  }

  await captureServer(user.id, 'beta_code_submitted', { ok: true });
  await captureServer(user.id, 'beta_redeemed', {
    code: grant.code,
    posts_quota: grant.postsQuota,
    days: coupon!.days ?? 0,
  });

  return NextResponse.json({
    ok: true,
    code: grant.code,
    posts_quota: grant.postsQuota,
    expires_at: grant.expiresAt,
  });
}

type Admin = ReturnType<typeof supabaseAdmin>;

/** Take one redemption off the coupon, atomically. See consumeQuota for the pattern. */
async function reserveRedemption(
  admin: Admin,
  couponId: string,
): Promise<{ ok: true } | { ok: false; problem: CouponProblem }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: row } = await admin
      .from('beta_coupons')
      .select('active, expires_at, max_redemptions, redeemed_count')
      .eq('id', couponId)
      .maybeSingle();

    // Re-checked inside the loop, not just before it: a coupon can be
    // deactivated or exhausted by someone else between our read and our write.
    const problem = couponProblem(row);
    if (problem) return { ok: false, problem };

    const current = Math.max(0, row!.redeemed_count ?? 0);
    const { data: won } = await admin
      .from('beta_coupons')
      .update({ redeemed_count: current + 1 })
      .eq('id', couponId)
      .eq('redeemed_count', current)
      .select('id')
      .maybeSingle();

    if (won) return { ok: true };
  }
  // Sustained contention on one coupon. Refuse rather than fail open: over-
  // redeeming a giveaway costs real generation capacity, and the customer can
  // simply try again.
  return { ok: false, problem: 'exhausted' };
}

/** Hand a reservation back when the redemption it was taken for didn't happen. */
async function releaseRedemption(admin: Admin, couponId: string): Promise<void> {
  try {
    const { data } = await admin
      .from('beta_coupons').select('redeemed_count').eq('id', couponId).maybeSingle();
    const current = Math.max(0, data?.redeemed_count ?? 0);
    await admin
      .from('beta_coupons')
      .update({ redeemed_count: Math.max(0, current - 1) })
      .eq('id', couponId)
      .eq('redeemed_count', current);
  } catch { /* never mask the caller's real error */ }
}
