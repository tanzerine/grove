import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { REFUND_REASONS } from '@/lib/refunds';
import CancelFunnel from './CancelFunnel';
import { DashHeader } from '../../gv-chrome';

export const dynamic = 'force-dynamic';

export default async function CancelPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login');

  // Best-effort plan label for the header (tolerate pre-migration state).
  let plan: string | null = null;
  try {
    const { data } = await sb
      .from('subscriptions').select('plan, stripe_status').eq('user_id', user.id).maybeSingle();
    const active = data?.stripe_status && ['active', 'trialing', 'past_due'].includes(data.stripe_status);
    if (active && data?.plan) plan = data.plan;
  } catch { /* ignore */ }

  return (
    <>
      <DashHeader title="Cancel & request a refund" subtitle="We're sorry to see you go" />
      <div className="gv-body">
        <CancelFunnel reasons={REFUND_REASONS} plan={plan} />
      </div>
    </>
  );
}
