import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { isBillingInterval, isPlanId, priceIdFor } from '@/lib/plans';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';

// Stripe's SDK needs the Node runtime (not edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// interval is optional so older clients keep getting the monthly price.
const body = z.object({ plan: z.string(), interval: z.string().optional() });

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

export async function POST(req: Request) {
  // 1) Auth — only the signed-in user can start their own checkout.
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 2) Throttle — cheap, but it hits Stripe, so don't let it be hammered.
  const limited = await enforceRateLimit(`billing:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured yet.' }, { status: 503 });
  }

  // 3) Validate the plan/interval and resolve the price id SERVER-SIDE. The
  //    client only sends names from a fixed set; it can never dictate the
  //    amount charged — the discount lives in Stripe, not in the request.
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isPlanId(parsed.data.plan)) {
    return NextResponse.json({ error: 'invalid plan' }, { status: 400 });
  }
  const rawInterval = parsed.data.interval ?? 'month';
  if (!isBillingInterval(rawInterval)) {
    return NextResponse.json({ error: 'invalid interval' }, { status: 400 });
  }
  const plan = parsed.data.plan;
  const interval = rawInterval;
  const priceId = priceIdFor(plan, interval);
  if (!priceId) {
    return NextResponse.json({ error: 'plan price not configured' }, { status: 503 });
  }

  const stripe = getStripe();
  // Service-role client: needed because subscriptions is read-only under RLS.
  // Strictly scoped to this verified user's own row (user.id), so no IDOR.
  const admin = supabaseAdmin();

  try {
    // 4) Find or create the Stripe customer for this user.
    const { data: subRow } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = subRow?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await admin
        .from('subscriptions')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);
    }

    // 5) Create the Checkout Session. Entitlements are NOT granted here — only
    //    the webhook (checkout.session.completed / subscription.*) does that.
    const origin = appOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/dashboard/billing?status=success`,
      cancel_url: `${origin}/dashboard/billing?status=cancel`,
      // Echoed back on webhook events so we can resolve the user robustly.
      metadata: { userId: user.id, plan, interval },
      subscription_data: { metadata: { userId: user.id, plan } },
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    // Never leak Stripe internals/keys to the client.
    console.error('[billing/checkout] error:', (e as Error).message);
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 });
  }
}
