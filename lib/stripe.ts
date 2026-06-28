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
