import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PLANS, PLAN_IDS, isPlanId } from '@/lib/plans';
import BillingClient from './BillingClient';
import { HeaderRight } from '../gv-chrome';

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
    current_period_end?: string | null;
  } | null = null;
  try {
    const { data } = await sb
      .from('subscriptions')
      .select('plan, stripe_status, stripe_customer_id, current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();
    sub = data;
  } catch { /* columns not migrated yet — show plans, no active subscription */ }

  const status = (sub?.stripe_status as string | null) ?? null;
  const isActive = !!status && ACTIVE_STATUSES.includes(status);
  const currentPlan = isActive && isPlanId(sub?.plan) ? sub!.plan : null;

  return (
    <>
      <header className="gv-header">
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Billing</div>
          <div style={{ fontSize: 12, color: '#6b6f67', marginTop: 1 }}>Your plan &amp; payments</div>
        </div>
        <HeaderRight />
      </header>
      <div className="gv-body">
        <BillingClient
          plans={PLAN_IDS.map((id) => PLANS[id])}
          currentPlan={currentPlan}
          status={status}
          hasCustomer={!!sub?.stripe_customer_id}
          currentPeriodEnd={(sub?.current_period_end as string | null) ?? null}
        />
      </div>
    </>
  );
}
