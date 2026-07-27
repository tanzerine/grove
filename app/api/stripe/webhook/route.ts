import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLANS, planForPriceId } from '@/lib/plans';
import { captureServer } from '@/lib/analytics/capture-server';
import { classifyClaim, isDuplicate, shouldReleaseClaim } from '@/lib/stripe-idempotency';

// MUST be the Node runtime: signature verification needs the raw request body
// and Stripe's crypto. Edge would mangle the body and break verification.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Admin = ReturnType<typeof supabaseAdmin>;

/** Update the user's subscription row from a Stripe subscription snapshot. */
async function applySubscription(
  admin: Admin,
  fields: {
    userId: string | null;
    customerId: string | null;
    subscriptionId: string | null;
    status: string | null;
    priceId: string | null;
    currentPeriodEnd: number | null; // unix seconds
  },
) {
  const plan = planForPriceId(fields.priceId);
  const patch: Record<string, unknown> = {
    stripe_status: fields.status,
    stripe_subscription_id: fields.subscriptionId,
    stripe_price_id: fields.priceId,
    current_period_end: fields.currentPeriodEnd
      ? new Date(fields.currentPeriodEnd * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  };
  if (fields.customerId) patch.stripe_customer_id = fields.customerId;
  if (plan) {
    patch.plan = plan;
    patch.posts_quota = PLANS[plan].postsQuota;
  }

  // Prefer the user id carried in metadata; fall back to the customer id we
  // stored at checkout. Both paths are server-trusted (from a verified event).
  if (fields.userId) {
    await admin.from('subscriptions').update(patch).eq('user_id', fields.userId);
  } else if (fields.customerId) {
    await admin.from('subscriptions').update(patch).eq('stripe_customer_id', fields.customerId);
  } else {
    console.error('[stripe/webhook] cannot resolve user for event');
  }
}

function subFields(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  // current_period_end sits at the top level on older API versions and on the
  // subscription item on newer ones — read whichever is present.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    null;
  return {
    userId: (sub.metadata?.userId as string) || null,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
    subscriptionId: sub.id,
    status: sub.status,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: periodEnd,
  };
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }

  // Read the RAW body (string) — required for signature verification.
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    // Bad signature or tampered payload — reject. Do not process.
    console.error('[stripe/webhook] signature verification failed:', (e as Error).message);
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // Idempotency: record the event id; if it's already there, we've handled it.
  // Fail OPEN if the table is missing (pre-migration) so we never silently
  // drop real billing events — we only short-circuit on a true duplicate.
  //
  // The row is claimed BEFORE processing so two concurrent deliveries of the
  // same event can't both run the handler. That ordering is deliberate, but it
  // means the claim must be RELEASED if processing then fails — see the catch.
  const { error: dupErr } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  const claim = classifyClaim(dupErr as { code?: string } | null);
  if (isDuplicate(claim)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
          (session.metadata?.userId as string) || session.client_reference_id || null;
        const customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id ?? null;

        if (subId) {
          const sub = await getStripe().subscriptions.retrieve(subId);
          const f = subFields(sub);
          await applySubscription(admin, { ...f, userId: userId || f.userId, customerId: customerId || f.customerId });

          // captureServer cannot throw, which matters more here than anywhere
          // else in the codebase: this call sits inside the handler's try, and
          // the idempotency row is already written, so a rejection would 500 →
          // Stripe retries → the retry short-circuits as a duplicate.
          await captureServer((userId || f.userId)!, 'subscription_activated', {
            plan: planForPriceId(f.priceId) ?? undefined,
            interval: session.metadata?.interval,
          });
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        await applySubscription(admin, subFields(sub));
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const f = subFields(sub);
        // Mark canceled; keep the record for history. (No enforcement yet, so
        // we don't zero the quota — that's the deliberate plumbing-only scope.)
        await applySubscription(admin, { ...f, status: 'canceled' });

        if (f.userId) {
          await captureServer(f.userId, 'subscription_canceled', {
            plan: planForPriceId(f.priceId) ?? undefined,
          });
        }
        break;
      }
      default:
        // Unhandled event types are fine — we acknowledged + logged the id.
        break;
    }
  } catch (e) {
    console.error('[stripe/webhook] handler error:', (e as Error).message);
    // Release the idempotency claim so Stripe's retry can actually run.
    //
    // Without this the 500 below is a silent, permanent data-loss bug: Stripe
    // redelivers, the insert above hits 23505, and the request short-circuits
    // as a "duplicate" having never processed the event. Because checkout
    // deliberately grants no entitlement and this webhook is the ONLY writer of
    // subscriptions.stripe_status, a single blip inside the handler (a
    // subscriptions.retrieve timeout, say) meant: customer paid, customer has
    // no access, and no retry could ever fix it.
    //
    // Deleting is safe because our writes are last-write-wins patches keyed by
    // user/customer id — replaying the event produces the same row. Best-effort
    // on purpose: if the delete itself fails we still want the 500, since a
    // retry that gets swallowed is strictly better than no retry at all.
    if (shouldReleaseClaim(claim)) {
      try {
        await admin.from('stripe_events').delete().eq('id', event.id);
      } catch (delErr) {
        console.error('[stripe/webhook] could not release idempotency claim:', delErr);
      }
    }
    // 500 → Stripe retries, and now the retry reaches the handler.
    return NextResponse.json({ error: 'handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
