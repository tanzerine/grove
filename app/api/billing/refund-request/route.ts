import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { REFUND_REASON_CODES } from '@/lib/refunds';
import { getStripe, stripeConfigured, resolveRefundable, formatAmount } from '@/lib/stripe';
import { sendEmail } from '@/lib/email/resend';
import { composeRefundOwnerEmail } from '@/lib/email/refund';
import { ownerNotifyEmail } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  reason: z.string().refine((r) => REFUND_REASON_CODES.includes(r), 'invalid reason'),
  feedback: z.string().max(2000).optional(),
  comeback: z.string().max(2000).optional(),
});

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// Customer-facing: records the exit survey + refund request and emails the
// owner. Deliberately moves NO money — a refund is only issued later by an
// owner-approved action (see [id]/route.ts).
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`refundreq:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const admin = supabaseAdmin();

  // Pull subscription context (scoped to this verified user).
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('plan, stripe_customer_id, stripe_subscription_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Best-effort: see whether there's actually a refundable charge (for the
  // owner email + to set the right status). Never blocks the request.
  let refundable = null as Awaited<ReturnType<typeof resolveRefundable>>;
  if (stripeConfigured() && (subRow?.stripe_subscription_id || subRow?.stripe_customer_id)) {
    try {
      refundable = await resolveRefundable(getStripe(), {
        subscriptionId: subRow?.stripe_subscription_id,
        customerId: subRow?.stripe_customer_id,
      });
    } catch { /* non-fatal */ }
  }

  const { data: inserted, error: insErr } = await admin
    .from('refund_requests')
    .insert({
      user_id: user.id,
      email: user.email ?? null,
      plan: subRow?.plan ?? null,
      reason: parsed.data.reason,
      feedback: parsed.data.feedback ?? null,
      comeback: parsed.data.comeback ?? null,
      stripe_customer_id: subRow?.stripe_customer_id ?? null,
      stripe_subscription_id: subRow?.stripe_subscription_id ?? null,
      stripe_payment_intent_id: refundable?.paymentIntentId ?? null,
      status: refundable ? 'pending' : 'no_charge',
      amount_cents: refundable?.amountCents ?? null,
      currency: refundable?.currency ?? null,
    })
    .select('id')
    .single();

  if (insErr) {
    console.error('[refund-request] insert error:', insErr.message);
    return NextResponse.json({ error: 'could not record request' }, { status: 500 });
  }

  // Notify the owner (best-effort — a mail hiccup must not fail the request).
  try {
    const { subject, html, text } = composeRefundOwnerEmail({
      email: user.email ?? null,
      plan: subRow?.plan ?? null,
      reason: parsed.data.reason,
      feedback: parsed.data.feedback ?? null,
      comeback: parsed.data.comeback ?? null,
      hasCharge: !!refundable,
      amountLabel: refundable ? formatAmount(refundable.amountCents, refundable.currency) : null,
      adminUrl: `${appOrigin(req)}/dashboard/admin/refunds`,
    });
    await sendEmail({ to: ownerNotifyEmail(), subject, html, text });
  } catch (e) {
    console.error('[refund-request] notify error:', (e as Error).message);
  }

  return NextResponse.json({ ok: true, id: inserted.id });
}
