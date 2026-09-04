/**
 * SERVER-ONLY reads and writes over `operator_plan_items` (migration 0038).
 *
 * Split from lib/operator-plan.ts for the reason beta-store is split from beta
 * and outreach/store from outreach/screen: the pure module is imported by the
 * admin CLIENT component, and must never drag the service-role client into a
 * browser bundle.
 *
 * Reads are best-effort and return empty rather than throwing, so the admin
 * page renders before 0038 is applied instead of 500-ing. Writes are NOT
 * softened that way: a silently-dropped task is worse than an error message,
 * because the operator will believe they wrote it down.
 */
import { supabaseAdmin } from './supabase/admin';
import {
  type Horizon, type PlanStatus,
  periodKeyFor, parentPeriodKey, todayKey,
} from './operator-plan';

export type PlanItem = {
  id: string;
  horizon: Horizon;
  period_key: string;
  title: string;
  notes: string | null;
  status: PlanStatus;
  parent_id: string | null;
  sort: number;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLS = 'id, horizon, period_key, title, notes, status, parent_id, sort, done_at, created_at, updated_at';

/** Everything in one exact period, in the operator's own order. */
export async function itemsInPeriod(horizon: Horizon, key: string): Promise<PlanItem[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('operator_plan_items')
      .select(COLS)
      .eq('horizon', horizon)
      .eq('period_key', key)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(500);
    return (data as PlanItem[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * Unfinished DAY tasks left behind in periods before `beforeDay`.
 *
 * This is the feature that decides whether a daily planner survives contact
 * with a real week. Without it, anything not finished on the day it was
 * written silently disappears the moment midnight passes, and the operator
 * learns not to trust the tool.
 *
 * Bounded to the last `windowDays` so the column doesn't slowly fill with
 * every task ever abandoned — at some point a two-month-old todo is a decision
 * not to do it, and it belongs in `dropped`, not at the top of today.
 */
export async function carriedOver(beforeDay: string, windowDays = 30): Promise<PlanItem[]> {
  const from = new Date(Date.parse(`${beforeDay}T00:00:00Z`) - windowDays * 86_400_000)
    .toISOString().slice(0, 10);
  try {
    const { data } = await supabaseAdmin()
      .from('operator_plan_items')
      .select(COLS)
      .eq('horizon', 'day')
      .in('status', ['todo', 'doing'])
      .gte('period_key', from)
      .lt('period_key', beforeDay)
      .order('period_key', { ascending: true })
      .limit(100);
    return (data as PlanItem[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * The whole board for one anchor day: the month, week and day containing it,
 * plus the carry-over and the parent items each column can be linked to.
 *
 * Assembled in ONE place because the three columns are not independent — a day
 * task links to a week focus that links to a month goal, and fetching them
 * from three separate callers is how those links end up pointing at rows that
 * are no longer on screen.
 */
export type PlanBoard = {
  anchor: string;
  keys: Record<Horizon, string>;
  items: Record<Horizon, PlanItem[]>;
  carried: PlanItem[];
  /** Month goals a WEEK item may be linked to, when the ISO week's month
   *  differs from the anchor's. Kept out of `items.month` so the month column
   *  still shows exactly one month. Empty in the common case. */
  weekLinkTargets: PlanItem[];
};

export async function planBoard(anchor: string): Promise<PlanBoard> {
  const keys = {
    month: periodKeyFor('month', anchor),
    week: periodKeyFor('week', anchor),
    day: anchor,
  };
  // The week's parent month can differ from the anchor's own month for a week
  // straddling the 1st (parentPeriodKey uses the ISO Thursday). When it does,
  // the week column's link targets live in that month, not the one on screen.
  const linkMonth = parentPeriodKey('week', keys.week) ?? keys.month;

  const [month, week, day, carried, linkTargets] = await Promise.all([
    itemsInPeriod('month', keys.month),
    itemsInPeriod('week', keys.week),
    itemsInPeriod('day', keys.day),
    carriedOver(anchor),
    linkMonth === keys.month ? Promise.resolve([]) : itemsInPeriod('month', linkMonth),
  ]);

  return {
    anchor,
    keys,
    items: { month, week, day },
    carried,
    weekLinkTargets: linkTargets,
  };
}

/* ── writes ────────────────────────────────────────────────────────────── */

export type NewItem = {
  horizon: Horizon;
  period_key: string;
  title: string;
  notes?: string | null;
  parent_id?: string | null;
};

/** Append to the bottom of its column. */
export async function createItem(input: NewItem): Promise<PlanItem> {
  const existing = await itemsInPeriod(input.horizon, input.period_key);
  const { data, error } = await supabaseAdmin()
    .from('operator_plan_items')
    .insert({ ...input, sort: existing.length })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as PlanItem;
}

export type ItemPatch = {
  title?: string;
  notes?: string | null;
  status?: PlanStatus;
  parent_id?: string | null;
  period_key?: string;
  sort?: number;
};

export async function updateItem(id: string, patch: ItemPatch): Promise<PlanItem | null> {
  // `done_at` is derived from the status rather than accepted from the client,
  // so "when did I finish this" can never disagree with "is it finished".
  const derived: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status) derived.done_at = patch.status === 'done' ? new Date().toISOString() : null;

  const { data, error } = await supabaseAdmin()
    .from('operator_plan_items')
    .update(derived)
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PlanItem) ?? null;
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from('operator_plan_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Rewrite one column's order as a dense 0..n-1 sequence.
 *
 * The whole list is sent and rewritten rather than swapping the two moved
 * rows, because a swap leaves the column's other rows on whatever sort values
 * they had — including the duplicate zeros every row starts life with — and
 * the next move then reorders something the operator didn't touch.
 */
export async function reorder(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id, i) =>
    supabaseAdmin().from('operator_plan_items').update({ sort: i }).eq('id', id),
  ));
}

/** Open day tasks for today plus anything carried in — the overview card. */
export async function planTodayCount(today: string = todayKey()): Promise<{ open: number; carried: number }> {
  const [todays, carried] = await Promise.all([itemsInPeriod('day', today), carriedOver(today)]);
  return {
    open: todays.filter((i) => i.status === 'todo' || i.status === 'doing').length,
    carried: carried.length,
  };
}
