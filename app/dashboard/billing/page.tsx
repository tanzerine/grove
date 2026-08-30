import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PLANS, PLAN_IDS, isPlanId, resolvePriceId } from '@/lib/plans';
import { quotaFrom } from '@/lib/quota';
import { betaStateFrom, hasLivePaidSubscription } from '@/lib/beta';
import BillingClient from './BillingClient';
import BetaPanel from './BetaPanel';
import { DashHeader } from '../gv-chrome';
import { getT } from '@/lib/i18n/server';
import type { T } from '@/lib/i18n';

/** This month's posts used vs included, so the ceiling is visible before it's hit. */
function QuotaMeter({ used, limit, resetsAt, t }: { used: number; limit: number; resetsAt: string; t: T }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const fill = pct >= 100 ? 'var(--gv-red-text)' : pct >= 80 ? '#d9a441' : 'var(--gv-accent)';
  const resets = new Date(resetsAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  return (
    <div style={{ background: 'var(--gv-card)', border: '1px solid var(--gv-line)', borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--gv-ink)' }}>
          {used} of {limit} posts used this month
        </div>
        <div style={{ fontSize: 12, color: 'var(--gv-faint)' }}>resets {resets}</div>
      </div>
      <div style={{ marginTop: 10, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: fill, borderRadius: 999 }} />
      </div>
      {pct >= 100 && (
        <div style={{ marginTop: 9, fontSize: 12.5, color: 'var(--gv-dim)' }}>
          {t('Generation is paused until the quota resets — upgrade below for more.')}
        </div>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

export default async function BillingPage() {
  const t = await getT();
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
    posts_quota?: number | null;
    posts_used?: number | null;
    cycle_resets_at?: string | null;
    beta_code?: string | null;
    beta_expires_at?: string | null;
    beta_posts_quota?: number | null;
  } | null = null;
  try {
    const { data } = await sb
      .from('subscriptions')
      // `*` rather than a column list, for the reason lib/quota documents: a
      // column this page reads but the database hasn't got yet (0033's beta_*)
      // fails a named select outright, and here that would blank the whole
      // billing page rather than just hiding the beta panel.
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    sub = data;
  } catch { /* columns not migrated yet — show plans, no active subscription */ }

  // Usage against this month's allowance. Shown so nobody discovers their
  // limit by hitting it mid-generation.
  const quota = quotaFrom(sub);

  const status = (sub?.stripe_status as string | null) ?? null;
  const isActive = !!status && ACTIVE_STATUSES.includes(status);
  const currentPlan = isActive && isPlanId(sub?.plan) ? sub!.plan : null;
  // The price id is the only record of which interval they bought.
  const currentInterval = currentPlan
    ? resolvePriceId(sub?.stripe_price_id)?.interval ?? null
    : null;

  const beta = betaStateFrom(sub);

  // The meter is shown to accounts that can actually generate — paid OR on a
  // live beta grant, which is metered just as strictly. It stays hidden from an
  // account with neither, whose row still carries the schema's default quota:
  // "0 of 4 posts used" is a promise we haven't made to someone who can't
  // generate at all.
  const showMeter = (isActive || beta.active) && quota.enforced && quota.limit !== null;

  return (
    <>
      <DashHeader title="Billing" subtitle={t('Your plan & payments')} />
      <div className="gv-body">
        {showMeter && (
          <QuotaMeter t={t} used={quota.used} limit={quota.limit!} resetsAt={quota.resetsAt} />
        )}
        <BetaPanel beta={beta} hasPaidPlan={hasLivePaidSubscription(sub)} />
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
