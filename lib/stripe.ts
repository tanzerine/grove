import Stripe from 'stripe';

/**
 * Server-only Stripe client. STRIPE_SECRET_KEY must never be a NEXT_PUBLIC_
 * var. Lazily constructed so the app can build/prerender without the key
 * present (the key is only needed when a billing route actually runs).
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  // apiVersion intentionally omitted → pinned to the installed SDK's default,
  // which matches the account's API version. Avoids literal-version drift.
  _stripe = new Stripe(key);
  return _stripe;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type Refundable = {
  paymentIntentId?: string;
  chargeId?: string;
  amountCents: number;
  currency: string;
};

/**
 * Find the most recent SUCCESSFUL, not-fully-refunded charge for a
 * customer/subscription so it can be refunded. Returns null when there's
 * nothing to refund (e.g. the only payment failed — the common real case).
 * Best-effort + defensive: any Stripe error resolves to null rather than throw.
 */
export async function resolveRefundable(
  stripe: Stripe,
  opts: { subscriptionId?: string | null; customerId?: string | null },
): Promise<Refundable | null> {
  // 1) Prefer the subscription's latest invoice payment intent.
  if (opts.subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(opts.subscriptionId, {
        expand: ['latest_invoice.payment_intent'],
      });
      const inv = sub.latest_invoice as Stripe.Invoice | null;
      const pi = inv
        ? ((inv as unknown as { payment_intent?: Stripe.PaymentIntent }).payment_intent ?? null)
        : null;
      if (pi && pi.status === 'succeeded' && (pi.amount_received ?? 0) > 0) {
        return { paymentIntentId: pi.id, amountCents: pi.amount_received, currency: pi.currency };
      }
    } catch {
      /* fall through to charge listing */
    }
  }

  // 2) Fall back to the most recent refundable charge on the customer.
  if (opts.customerId) {
    try {
      const charges = await stripe.charges.list({ customer: opts.customerId, limit: 10 });
      for (const ch of charges.data) {
        const remaining = ch.amount - ch.amount_refunded;
        if (ch.paid && ch.status === 'succeeded' && !ch.refunded && remaining > 0) {
          return { chargeId: ch.id, amountCents: remaining, currency: ch.currency };
        }
      }
    } catch {
      /* nothing refundable */
    }
  }

  return null;
}

export function formatAmount(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
