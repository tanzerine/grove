import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { normalizeCode, randomCode, DEFAULT_BETA_DAYS, DEFAULT_BETA_POSTS_QUOTA } from '@/lib/beta';
import { deliverablePostsPerMonth } from '@/lib/pipeline/capacity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  // Omit to have one generated. A memorable code is better for a campaign
  // ("LAUNCH25"); a generated one is better for a one-to-one invite.
  code: z.string().max(64).optional(),
  label: z.string().max(120).optional(),
  posts_quota: z.number().int().min(1).max(500).optional(),
  days: z.number().int().min(1).max(365).optional(),
  max_redemptions: z.number().int().min(1).max(100_000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  note: z.string().max(500).optional(),
});

/** Crypto-backed digit source for generated codes — Math.random is not one. */
const secureRand = () => randomInt(0, 1 << 30) / (1 << 30);

/**
 * Owner-only: mint a beta coupon.
 *
 * The response carries a capacity warning rather than a hard cap. Grove's real
 * ceiling is ticks/day x posts/tick (~720 posts/month platform-wide, see
 * lib/pipeline/capacity), and a coupon capped at 100 redemptions x 12 posts
 * promises 1,200 — more than the platform can physically produce, before a
 * single paying customer is served. Refusing to mint it would be wrong (the
 * owner may know redemption will be 10%); saying nothing would be worse. So the
 * arithmetic is done here, once, where the decision is being made.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const input = parsed.data;

  const code = input.code ? normalizeCode(input.code) : randomCode(10, secureRand);
  if (!code) {
    return NextResponse.json(
      { error: 'invalid_code', message: 'A code needs at least one letter or digit.' },
      { status: 400 },
    );
  }

  const postsQuota = input.posts_quota ?? DEFAULT_BETA_POSTS_QUOTA;
  const maxRedemptions = input.max_redemptions ?? null;

  const admin = supabaseAdmin();
  const { data: created, error } = await admin
    .from('beta_coupons')
    .insert({
      code,
      label: input.label?.trim() || null,
      posts_quota: postsQuota,
      days: input.days ?? DEFAULT_BETA_DAYS,
      max_redemptions: maxRedemptions,
      expires_at: input.expires_at ?? null,
      note: input.note?.trim() || null,
      created_by: user.email ?? 'admin',
    })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique_violation on `code`.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'duplicate', message: `The code ${code} already exists.` },
        { status: 409 },
      );
    }
    console.error('[admin/beta-coupons] insert error:', error.message);
    return NextResponse.json({ error: 'could not create coupon' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, coupon: created, warning: capacityWarning(maxRedemptions, postsQuota) });
}

/**
 * Would this coupon, fully redeemed, promise more than the platform can make?
 *
 * Uses the same measured figures the admin overview does, so this can't drift
 * from the real ceiling when the cron schedule changes.
 */
function capacityWarning(maxRedemptions: number | null, postsQuota: number): string | null {
  const capacity = deliverablePostsPerMonth();
  if (maxRedemptions === null) {
    return `This code has no redemption cap. Grove can produce about ${capacity.toLocaleString()} posts a month in total, across every account — set a cap unless you're watching redemptions closely.`;
  }
  const promised = maxRedemptions * postsQuota;
  // Half the platform is the line: beta testers are guests, and a giveaway that
  // can consume more than half of everything Grove makes is competing with the
  // customers who pay for it.
  if (promised <= capacity / 2) return null;
  return `Fully redeemed, this code promises ${promised.toLocaleString()} posts a month against a platform capacity of about ${capacity.toLocaleString()}. Raise the cron frequency in vercel.json or lower the cap.`;
}
