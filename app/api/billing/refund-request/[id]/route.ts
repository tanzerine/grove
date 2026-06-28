import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { getStripe, stripeConfigured, resolveRefundable } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ action: z.enum(['refund', 'dismiss']) });

// Owner-only: issue (or dismiss) a refund for a pending request. This is the
// ONLY path that moves money, and it is gated behind the admin email allow-list.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Gate: authenticated AND on the admin allow-list (email from a verified session).
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: reqRow } = await admin
    .from('refund_requests')
    .select('id, status, stripe_customer_id, stripe_subscription_id')
    .eq('id', id)
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Guard against double-processing (idempotency at the row level).
  if (reqRow.status === 'refunded' || reqRow.status === 'dismissed') {
    return NextResponse.json({ error: `already ${reqRow.status}` }, { status: 409 });
  }

  const stamp = { processed_at: new Date().toISOString(), processed_by: user.email ?? 'admin' };

  if (parsed.data.action === 'dismiss') {
    await admin.from('refund_requests').update({ status: 'dismissed', ...stamp }).eq('id', id);
    return NextResponse.json({ ok: true, status: 'dismissed' });
  }

  // action === 'refund'
  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured.' }, { status: 503 });
  }
  const stripe = getStripe();

  // Re-resolve at approval time (fresher than submit-time).
  const refundable = await resolveRefundable(stripe, {
    subscriptionId: reqRow.stripe_subscription_id,
    customerId: reqRow.stripe_customer_id,
  });
  if (!refundable) {
    await admin.from('refund_requests').update({ status: 'no_charge', ...stamp }).eq('id', id);
    return NextResponse.json({ ok: true, status: 'no_charge', message: 'No refundable charge found.' });
  }

  try {
    const refund = await stripe.refunds.create(
      refundable.paymentIntentId
        ? { payment_intent: refundable.paymentIntentId }
        : { charge: refundable.chargeId! },
      { idempotencyKey: `refundreq_${id}` }, // safe to retry without double-refunding
    );

    // Cancel the subscription too (best-effort — may already be canceled).
    if (reqRow.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(reqRow.stripe_subscription_id);
      } catch (e) {
        console.error('[refund approve] cancel sub failed:', (e as Error).message);
      }
    }

    await admin
      .from('refund_requests')
      .update({
        status: 'refunded',
        refund_id: refund.id,
        amount_cents: refundable.amountCents,
        currency: refundable.currency,
        stripe_payment_intent_id: refundable.paymentIntentId ?? null,
        ...stamp,
      })
      .eq('id', id);

    return NextResponse.json({ ok: true, status: 'refunded', refundId: refund.id });
  } catch (e) {
    console.error('[refund approve] refund failed:', (e as Error).message);
    await admin.from('refund_requests').update({ status: 'failed', ...stamp }).eq('id', id);
    return NextResponse.json({ error: 'Refund failed at Stripe — check the dashboard.' }, { status: 500 });
  }
}
