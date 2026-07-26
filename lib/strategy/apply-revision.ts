/**
 * Shared persistence for plan revisions and the monthly chat budget — used by
 * BOTH chat surfaces (/api/strategy/chat and the sidebar assistant at
 * /api/assistant/chat). Everything here writes plan_chat_messages-adjacent
 * state, so keeping it in one place guarantees the two UIs share one history,
 * one revision cap, and one swap-the-active-row transaction.
 */
import { supabaseAdmin } from '../supabase/admin';
import { PLAN_CHAT_LIMITS, reviseStrategy } from './plan-chat';
import { savePlanContext } from './context-store';
import { getQuota } from '../quota';
import type { Strategy } from './build';

export type PlanChatBudget = { messagesLeft: number; revisionsLeft: number };

/** Remaining monthly chat/revision allowance, counted from persisted rows so
 *  it holds across serverless instances and can't be bypassed client-side. */
export async function planChatBudget(domainId: string): Promise<PlanChatBudget> {
  const sb = supabaseAdmin();
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  const [{ count: msgs }, { count: revs }] = await Promise.all([
    sb.from('plan_chat_messages').select('id', { count: 'exact', head: true })
      .eq('domain_id', domainId).eq('role', 'user').gte('created_at', since),
    sb.from('plan_chat_messages').select('id', { count: 'exact', head: true })
      .eq('domain_id', domainId).eq('role', 'agent').eq('revised', true).gte('created_at', since),
  ]);
  return {
    messagesLeft: Math.max(0, PLAN_CHAT_LIMITS.messagesPerMonth - (msgs ?? 0)),
    revisionsLeft: Math.max(0, PLAN_CHAT_LIMITS.revisionsPerMonth - (revs ?? 0)),
  };
}

/** Project a strategies table row into the Strategy shape the reviser edits. */
export function strategyFromRow(row: any): Strategy {
  return {
    month: String(row.month).slice(0, 7),
    source: row.source,
    goals: row.goals ?? [],
    kpis: row.kpis ?? [],
    pillars: row.pillars ?? [],
    publishing_plan: row.publishing_plan ?? [],
    direction: row.direction ?? undefined,
    notes: row.notes ?? '',
  };
}

/**
 * Run one owner-requested revision end to end: lock slots that already have a
 * post, call the strategist, swap the active strategy row, re-link existing
 * posts to the new row, refresh the plan memo. Throws on failure — callers
 * reply with their own "plan unchanged" copy.
 */
export async function applyPlanRevision(opts: {
  domainId: string;
  hostname: string;
  postsPerWeek: number;
  strategyRow: any;          // the active strategies row (full select)
  instruction: string;
}): Promise<{ reply: string }> {
  const admin = supabaseAdmin();
  const { domainId, strategyRow } = opts;

  // Slots with a post already drafted or live must survive the revision.
  const { data: linkedPosts } = await admin
    .from('posts').select('slot_id, status')
    .eq('strategy_id', strategyRow.id).not('slot_id', 'is', null);
  const lockedSlotIds = (linkedPosts ?? [])
    .filter((p: any) => p.status !== 'failed')
    .map((p: any) => p.slot_id as string);

  // The owner can reshape the month, but not buy themselves a bigger one — the
  // revised plan is capped at the allowance like every other plan. Resolved
  // here so both chat surfaces get it without threading it through each call.
  const { data: ownerRow } = await admin
    .from('domains').select('user_id').eq('id', domainId).maybeSingle();
  const ownerId = (ownerRow as { user_id?: string } | null)?.user_id;
  const monthlyQuota = ownerId ? (await getQuota(ownerId)).limit : null;

  const outcome = await reviseStrategy({
    current: strategyFromRow(strategyRow),
    instruction: opts.instruction,
    hostname: opts.hostname,
    postsPerWeek: opts.postsPerWeek,
    lockedSlotIds,
    monthlyQuota,
  });

  // Swap the active strategy row: deactivate old, insert revised.
  await admin.from('strategies').update({ active: false })
    .eq('domain_id', domainId).eq('active', true);
  const { data: inserted } = await admin.from('strategies').insert({
    domain_id: domainId,
    month: strategyRow.month,
    source: 'revised',
    goals: outcome.strategy.goals,
    kpis: outcome.strategy.kpis,
    pillars: outcome.strategy.pillars,
    publishing_plan: outcome.strategy.publishing_plan,
    direction: outcome.strategy.direction ?? null,
    interview: strategyRow.interview ?? null,
    prev_review: strategyRow.prev_review ?? null,
    notes: outcome.strategy.notes,
    active: true,
  }).select('id').single();

  // Re-link existing posts to the new row so the scheduler doesn't
  // re-materialize slots that already have a post.
  if (inserted?.id) {
    await admin.from('posts').update({ strategy_id: inserted.id })
      .eq('strategy_id', strategyRow.id);
  }

  await savePlanContext(domainId, outcome.strategy, opts.hostname);
  return { reply: outcome.reply };
}
