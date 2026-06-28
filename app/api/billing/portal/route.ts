import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getStripe, stripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function appOrigin(req: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
}

// Opens Stripe's hosted Customer Portal so the user can update card, change
// plan, or cancel — and request the full refund (refunds are handled by you
// in the Stripe dashboard per the refund-on-request policy).
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!stripeConfigured()) {
    return NextResponse.json({ error: 'Billing is not configured yet.' }, { status: 503 });
  }

  // Resolve THIS user's customer id only (scoped to user.id → no IDOR).
  const admin = supabaseAdmin();
  const { data: subRow } = await admin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const customerId = subRow?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return NextResponse.json({ error: 'No billing account yet.' }, { status: 400 });
  }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appOrigin(req)}/dashboard/billing`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[billing/portal] error:', (e as Error).message);
    return NextResponse.json({ error: 'Could not open billing portal.' }, { status: 500 });
  }
}
