/**
 * Admin business-overview stats. Server-only — pulls from the service-role
 * Supabase client (auth users + subscriptions + refund_requests) and, when
 * configured, recent Stripe payments. Every section is wrapped so one failing
 * source (e.g. a not-yet-migrated table) degrades to zeros instead of blanking
 * the whole page.
 *
 * Gated by the caller (admin pages check isAdminEmail first) — this module does
 * NOT authorize; it only gathers.
 */
import { supabaseAdmin } from './supabase/admin';
import { getStripe, stripeConfigured } from './stripe';
import { PLANS, isPlanId } from './plans';

const ACTIVE = ['active', 'trialing', 'past_due'];

export type RecentUser = {
  email: string | null;
  createdAt: string;
  source: string;
  plan: string | null;
  status: string | null;
};
export type RecentPayment = {
  amountCents: number;
  currency: string;
  created: number; // unix seconds
  email: string | null;
  status: string;
  refunded: boolean;
};

export type AdminStats = {
  users: { total: number; new7d: number; new30d: number; recent: RecentUser[] };
  referrals: { source: string; count: number }[];
  subs: { active: number; byPlan: Record<string, number>; mrrUsd: number };
  refunds: { pending: number; refunded: number; total: number };
  payments: { configured: boolean; recent: RecentPayment[] };
};

function daysAgo(n: number): number {
  return Date.now() - n * 86400_000;
}

export async function getAdminStats(): Promise<AdminStats> {
  const admin = supabaseAdmin();

  const stats: AdminStats = {
    users: { total: 0, new7d: 0, new30d: 0, recent: [] },
    referrals: [],
    subs: { active: 0, byPlan: {}, mrrUsd: 0 },
    refunds: { pending: 0, refunded: 0, total: 0 },
    payments: { configured: stripeConfigured(), recent: [] },
  };

  // ── subscriptions: plan/status per user (also powers MRR) ──
  const subByUser = new Map<string, { plan: string | null; status: string | null }>();
  try {
    const { data } = await admin
      .from('subscriptions')
      .select('user_id, plan, stripe_status');
    for (const s of data ?? []) {
      const status = (s as any).stripe_status as string | null;
      const plan = (s as any).plan as string | null;
      subByUser.set((s as any).user_id, { plan, status });
      if (status && ACTIVE.includes(status)) {
        stats.subs.active++;
        if (plan && isPlanId(plan)) {
          stats.subs.byPlan[plan] = (stats.subs.byPlan[plan] ?? 0) + 1;
          stats.subs.mrrUsd += PLANS[plan].priceUsd;
        }
      }
    }
  } catch { /* subscriptions unreadable — leave zeros */ }

  // ── auth users: totals, new-signup windows, referral mix, recent list ──
  try {
    // Early-stage scale: one page of up to 1000 is plenty. Revisit with
    // pagination if the user base outgrows it.
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const users = data?.users ?? [];
    stats.users.total = users.length;

    const refCount = new Map<string, number>();
    const t7 = daysAgo(7);
    const t30 = daysAgo(30);

    for (const u of users) {
      const created = new Date(u.created_at).getTime();
      if (created >= t7) stats.users.new7d++;
      if (created >= t30) stats.users.new30d++;
      const source = (u.user_metadata?.referral_source as string) || 'Unknown';
      refCount.set(source, (refCount.get(source) ?? 0) + 1);
    }

    stats.referrals = [...refCount.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    stats.users.recent = [...users]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 12)
      .map((u) => {
        const sub = subByUser.get(u.id);
        return {
          email: u.email ?? null,
          createdAt: u.created_at,
          source: (u.user_metadata?.referral_source as string) || 'Unknown',
          plan: sub?.status && ACTIVE.includes(sub.status) ? sub.plan : null,
          status: sub?.status ?? null,
        };
      });
  } catch { /* listUsers unavailable — leave zeros */ }

  // ── refund requests: pipeline counts ──
  try {
    const { data } = await admin.from('refund_requests').select('status');
    for (const r of data ?? []) {
      stats.refunds.total++;
      const st = (r as any).status as string;
      if (st === 'pending') stats.refunds.pending++;
      if (st === 'refunded') stats.refunds.refunded++;
    }
  } catch { /* refund_requests not migrated — leave zeros */ }

  // ── Stripe: most recent payments (best-effort) ──
  if (stats.payments.configured) {
    try {
      const charges = await getStripe().charges.list({ limit: 8 });
      stats.payments.recent = charges.data.map((c) => ({
        amountCents: c.amount,
        currency: c.currency,
        created: c.created,
        email: c.billing_details?.email ?? c.receipt_email ?? null,
        status: c.status,
        refunded: c.refunded,
      }));
    } catch { /* Stripe read failed — leave empty */ }
  }

  return stats;
}
