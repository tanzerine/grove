/**
 * Billing entitlement — the single place that decides whether an account may
 * run cost-bearing generation (article pipeline, pSEO, section rewrites,
 * strategy builds). Pure decision logic first (unit-tested), thin fetchers on
 * top.
 *
 * Rule: generation requires a live Stripe subscription — `stripe_status` of
 * 'active' or 'trialing' (a Stripe trial means a card was entered at
 * checkout). Accounts that never checked out (stripe_status null) are NOT
 * entitled, regardless of the schema's built-in `trial_ends_at` — signup alone
 * must not grant LLM spend. Reading/editing existing posts stays free; this
 * gate covers creation of new AI work only.
 */
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase/admin';
import { captureServer } from './analytics/capture-server';
import { effectiveBeta, betaStateFrom } from './beta';

export type SubscriptionRow = {
  plan?: string | null;
  stripe_status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  /** Not metered at all — see migration 0030. */
  comped?: boolean | null;
  /** Free beta grant — see migration 0033 and lib/beta. */
  beta_code?: string | null;
  beta_expires_at?: string | null;
  beta_posts_quota?: number | null;
};

export type Entitlement = {
  canGenerate: boolean;
  reason: 'paying' | 'card_trial' | 'comped' | 'beta' | 'beta_expired' | 'not_paying' | 'no_subscription';
};

export function entitlementFrom(
  row: SubscriptionRow | null | undefined,
  now: Date = new Date(),
): Entitlement {
  if (!row) return { canGenerate: false, reason: 'no_subscription' };
  // A comped account keeps generating regardless of Stripe (migration 0030).
  // Checked before status so an internal account doesn't go dark the day a
  // card expires — which for the dogfooding domain would look like the product
  // itself breaking.
  if (row.comped) return { canGenerate: true, reason: 'comped' };
  const status = (row.stripe_status ?? '').toLowerCase();
  if (status === 'active') return { canGenerate: true, reason: 'paying' };
  if (status === 'trialing') return { canGenerate: true, reason: 'card_trial' };

  // A live beta grant (migration 0033). Reached only after the paid statuses
  // have returned, so an account that upgraded mid-beta is 'paying' and never
  // 'beta' — which keeps the analytics honest about who is actually funding us.
  if (effectiveBeta(row, now)) return { canGenerate: true, reason: 'beta' };

  // Distinguish a lapsed beta from someone who never had one. Both are blocked,
  // but only the first has already seen the product work, which is the single
  // most convertible state a customer is ever in — the paywall copy and the
  // funnel analytics both need to tell them apart.
  if (betaStateFrom(row, now).present) return { canGenerate: false, reason: 'beta_expired' };

  // past_due / canceled / unpaid / incomplete / '' (never checked out)
  return { canGenerate: false, reason: status ? 'not_paying' : 'no_subscription' };
}

/** Entitlement for one user. Pass a client to reuse one (RLS lets a user read
 *  their own row); defaults to the service role for cron/webhook contexts. */
export async function getEntitlement(
  userId: string,
  client?: SupabaseClient,
): Promise<Entitlement> {
  const sb = client ?? supabaseAdmin();
  const { data } = await sb
    .from('subscriptions')
    // `*` so a column this file reads but the database hasn't got yet (0030's
    // `comped`) can't fail the query outright and take entitlement down with
    // it. A missing column reads as undefined and the guard falls through.
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return entitlementFrom(data as SubscriptionRow | null);
}

export async function canGenerateForUser(userId: string, client?: SupabaseClient): Promise<boolean> {
  return (await getEntitlement(userId, client)).canGenerate;
}

/**
 * Route-handler convenience, mirroring `enforceQuota` and `enforceRateLimit`:
 * returns a 402 when the account may not run cost-bearing work, or null when
 * it may.
 *
 *   const blocked = await enforceEntitlement(user.id, 'generate', sb);
 *   if (blocked) return blocked;
 *
 * Six routes had this same check-and-402 block copy-pasted, which meant the
 * paywall's wording and status code could drift apart route by route, and there
 * was nowhere to observe it from. `feature` names what the customer was trying
 * to do, so the event distinguishes someone blocked from a full article
 * generation from someone blocked from a section rewrite — very different
 * intent, and previously indistinguishable.
 */
export async function enforceEntitlement(
  userId: string,
  feature: 'generate' | 'retry' | 'revise' | 'pseo_plan' | 'pseo_generate' | 'strategy_chat',
  client?: SupabaseClient,
): Promise<NextResponse | null> {
  const ent = await getEntitlement(userId, client);
  if (ent.canGenerate) return null;
  // `reason` is the entitlement verdict ('not_paying' vs 'no_subscription'),
  // which separates a lapsed customer from someone who never checked out.
  await captureServer(userId, 'generation_blocked_unpaid', { reason: ent.reason, feature });
  // A lapsed beta is a distinct funnel step, not just another blocked call:
  // it's the moment a free run either converts or churns, and it's the number
  // that says whether the beta programme paid for itself.
  if (ent.reason === 'beta_expired') await captureServer(userId, 'beta_expired_blocked', {});
  return NextResponse.json(
    {
      error: 'payment_required',
      // A lapsed beta tester is not a stranger who wandered into a paywall.
      // They know what the product does, they have posts on their own domain,
      // and telling them "an active subscription is required" reads as a door
      // closing rather than the one thing that is actually true: nothing they
      // made has been taken away.
      message:
        ent.reason === 'beta_expired'
          ? 'Your free beta has ended. Everything Grove published for you is still live and still yours — pick a plan to start writing again.'
          : 'An active subscription is required to generate content.',
    },
    { status: 402 },
  );
}

/** Batch check for cron loops: which of these user ids may generate?
 *  One query instead of N; unknown ids are simply not entitled. */
export async function entitledUserSet(userIds: string[]): Promise<Set<string>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return new Set();
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('subscriptions')
    .select('*')
    .in('user_id', unique);
  const out = new Set<string>();
  for (const row of data ?? []) {
    if (entitlementFrom(row as SubscriptionRow).canGenerate) out.add((row as any).user_id);
  }
  return out;
}
