import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PLANS, PLAN_IDS, isPlanId, resolvePriceId } from '@/lib/plans';
import BillingClient from './BillingClient';
import { DashHeader } from '../gv-chrome';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export default async function BillingPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  // RLS allows the user to read only their own row. Tolerate the pre-migration
  // state (Stripe columns absent) by degrading to "no active plan" instead of
  // 500-ing the page — so this can ship before migration 0014 is applied.
  let sub: {
    plan?: string | null;
    stripe_status?: string | null;
    stripe_customer_id?: string | null;
    stripe_price_id?: string | null;
    current_period_end?: string | null;
  } | null = null;
  try {
    const { data } = await sb
      .from('subscriptions')
      .select('plan, stripe_status, stripe_customer_id, stripe_price_id, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();
    sub = data;
  } catch { /* columns not migrated yet — show plans, no active subscription */ }

  const status = (sub?.stripe_status as string | null) ?? null;
  const isActive = !!status && ACTIVE_STATUSES.includes(status);
  const currentPlan = isActive && isPlanId(sub?.plan) ? sub!.plan : null;
  // The price id is the only record of which interval they bought.
  const currentInterval = currentPlan
    ? resolvePriceId(sub?.stripe_price_id)?.interval ?? null
    : null;

  return (
    <>
      <DashHeader title="Billing" subtitle="Your plan & payments" />
      <div className="gv-body">
        <BillingClient
          plans={PLAN_IDS.map((id) => PLANS[id])}
          currentPlan={currentPlan}
          currentInterval={currentInterval}
          status={status}
          hasCustomer={!!sub?.stripe_customer_id}
          currentPeriodEnd={(sub?.current_period_end as string | null) ?? null}
        />
      </div>
    </>
  );
}
