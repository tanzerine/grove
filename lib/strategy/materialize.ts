/**
 * Materialize plan → posts. This is the join that was missing entirely:
 * the strategist produced a publishing_plan every month, but nothing ever
 * turned those slots into posts, so the plan was decorative.
 *
 * Each scheduler tick, we look at the active strategy's slots whose
 * publish_date falls within the lead window, and create a queued post for any
 * slot that doesn't have one yet — carrying the slot's date through as the
 * post's scheduled_at and linking it back via strategy_id + slot_id.
 *
 * The normal "drain queued" step then drafts it; generate.ts preserves the
 * planned scheduled_at instead of inventing a new one.
 */
import { supabaseAdmin } from '../supabase/admin';
import type { Strategy, PostSlot } from './build';

export async function materializeDuePlanSlots(
  domainId: string,
  opts: { leadHours?: number; limit?: number } = {},
): Promise<string[]> {
  const { leadHours = 72, limit = 5 } = opts;
  const sb = supabaseAdmin();

  const { data: strat } = await sb
    .from('strategies')
    .select('id, publishing_plan')
    .eq('domain_id', domainId)
    .eq('active', true)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!strat) return [];

  const plan = ((strat as any).publishing_plan ?? []) as PostSlot[];
  if (!plan.length) return [];

  const cutoff = new Date(Date.now() + leadHours * 3600_000).toISOString();
  const due = plan
    .filter((s) => s.publish_date && s.publish_date <= cutoff)
    .sort((a, b) => (a.publish_date! < b.publish_date! ? -1 : 1));
  if (!due.length) return [];

  // Slots that already have a post for this strategy.
  const { data: existing } = await sb
    .from('posts')
    .select('slot_id')
    .eq('strategy_id', (strat as any).id)
    .not('slot_id', 'is', null);
  const have = new Set((existing ?? []).map((r: any) => r.slot_id));

  const created: string[] = [];
  for (const slot of due) {
    if (have.has(slot.id)) continue;
    if (created.length >= limit) break;
    const { data, error } = await sb
      .from('posts')
      .insert({
        domain_id: domainId,
        status: 'queued',
        topic: slot.topic,
        strategy_id: (strat as any).id,
        slot_id: slot.id,
        scheduled_at: slot.publish_date,   // planned date carried through
      })
      .select('id')
      .single();
    // unique (strategy_id, slot_id) index makes this race-safe; ignore conflicts
    if (!error && data) created.push(data.id);
  }
  return created;
}

/**
 * The plan slots that have NOT become posts yet — the future of the month.
 *
 * Slots are materialized only ~72h before their date, so for most of a month
 * most of the calendar exists ONLY here, in the strategy's publishing_plan.
 * A surface that draws the calendar from the posts table alone therefore shows
 * a nearly empty month and reads as "the agent has nothing planned", which is
 * the opposite of the truth — and is exactly how the dashboard home differed
 * from the calendar page, which had this filter inline.
 *
 * Pure, and shared, so the two can't drift apart again.
 */
export function unmaterializedSlots(
  plan: PostSlot[] | null | undefined,
  materializedSlotIds: Iterable<string | null | undefined>,
): PostSlot[] {
  const taken = new Set<string>();
  for (const id of materializedSlotIds) if (id) taken.add(id);
  return (plan ?? []).filter((s) => !!s.publish_date && !taken.has(s.id));
}

/** Re-derive a strategy's whole calendar without regenerating it — used after
 *  an owner changes posts_per_week or wants a fresh spread. (Pure helper.) */
export function planToCalendar(strategy: Pick<Strategy, 'publishing_plan'>): PostSlot[] {
  return [...(strategy.publishing_plan ?? [])].sort((a, b) =>
    (a.publish_date ?? '') < (b.publish_date ?? '') ? -1 : 1,
  );
}
