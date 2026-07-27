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

export type SubscriptionRow = {
  plan?: string | null;
  stripe_status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  /** Not metered at all — see migration 0030. */
  comped?: boolean | null;
};

export type Entitlement = {
  canGenerate: boolean;
  reason: 'paying' | 'card_trial' | 'comped' | 'not_paying' | 'no_subscription';
};

/** Stripe statuses that represent a live, generation-entitled subscription. */
const LIVE_STATUSES = new Set(['active', 'trialing']);

export function entitlementFrom(row: SubscriptionRow | null | undefined): Entitlement {
  if (!row) return { canGenerate: false, reason: 'no_subscription' };
  // A comped account keeps generating regardless of Stripe (migration 0030).
  // Checked before status so an internal account doesn't go dark the day a
  // card expires — which for the dogfooding domain would look like the product
  // itself breaking.
  if (row.comped) return { canGenerate: true, reason: 'comped' };
  const status = (row.stripe_status ?? '').toLowerCase();
  if (status === 'active') return { canGenerate: true, reason: 'paying' };
  if (status === 'trialing') return { canGenerate: true, reason: 'card_trial' };
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
  return NextResponse.json(
    { error: 'payment_required', message: 'An active subscription is required to generate content.' },
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
