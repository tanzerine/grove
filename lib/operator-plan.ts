/**
 * The operator planner's calendar arithmetic and roll-up — PURE, no I/O.
 *
 * THE ONE RULE HERE: civil dates in, civil dates out. Every function below
 * takes and returns a `YYYY-MM-DD` string, never a `Date` instant, and parses
 * those strings as UTC midnight purely as a calculation trick. That matters
 * because the operator is in KST: at 08:00 on the 5th, `new Date()` in UTC is
 * still the 4th, and a planner that puts today's tasks on yesterday is worse
 * than no planner. `todayKey()` is the ONLY function that reads a clock or a
 * timezone, and it reads the LOCAL one. Everything else is timezone-free.
 *
 * The keys are deliberately human-readable, because they end up in a URL, a
 * database row and an error message: '2026-09' | '2026-W36' | '2026-09-04'.
 *
 * Month names are a fixed table rather than `toLocaleDateString`: the admin
 * area is English-only by decision (see SideNav), and Intl output varies by
 * runtime, which would make these tests flaky for no gain.
 */

export type Horizon = 'month' | 'week' | 'day';
export type PlanStatus = 'todo' | 'doing' | 'done' | 'dropped';

export const HORIZONS: Horizon[] = ['month', 'week', 'day'];
export const PLAN_STATUSES: PlanStatus[] = ['todo', 'doing', 'done', 'dropped'];

/** Horizons that count as "not finished" when carrying work forward. */
export const OPEN_STATUSES: PlanStatus[] = ['todo', 'doing'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DAY_MS = 86_400_000;

/* ── civil-date primitives ─────────────────────────────────────────────── */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Parse 'YYYY-MM-DD' as UTC midnight. Calculation only — never an instant. */
function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmtDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(day: string, n: number): string {
  return fmtDay(new Date(parseDay(day).getTime() + n * DAY_MS));
}

/** Monday = 0 … Sunday = 6, the ISO ordering the week maths below assumes. */
function isoDow(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/**
 * Today, in the caller's OWN timezone.
 *
 * The whole reason this file avoids `Date` elsewhere: this is the single
 * boundary where a clock is read, and it must be read locally.
 */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ── key shapes ────────────────────────────────────────────────────────── */

const RE = {
  month: /^\d{4}-(0[1-9]|1[0-2])$/,
  week: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
  day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
} as const;

/**
 * Does this string address a real period at this horizon?
 *
 * Checked on the way into the API, not merely on the way out of the UI: a row
 * written with a key no view ever asks for is invisible forever, and it would
 * be invisible in exactly the silent way that makes it hard to notice.
 */
export function isPeriodKey(horizon: Horizon, key: string): boolean {
  if (!RE[horizon].test(key)) return false;
  // A regex accepts 2026-02-31 and 2026-W53 in a 52-week year; the round-trip
  // rejects both, because a normalised key always rebuilds itself.
  if (horizon === 'day') return fmtDay(parseDay(key)) === key;
  if (horizon === 'week') return weekKeyOf(weekStart(key)) === key;
  return true;
}

/* ── day → period ──────────────────────────────────────────────────────── */

/** ISO-8601 week key ('2026-W36') for the week containing this day. */
export function weekKeyOf(day: string): string {
  const d = parseDay(day);
  // The ISO week belongs to the year containing its Thursday. Shifting to that
  // Thursday first is what makes the year boundary come out right without a
  // pile of special cases (2027-01-01 is in 2026-W53, and this yields that).
  const thu = new Date(d.getTime() + (3 - isoDow(d)) * DAY_MS);
  const year = thu.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = new Date(jan4.getTime() - isoDow(jan4) * DAY_MS);
  const week = 1 + Math.round((thu.getTime() - week1.getTime()) / (7 * DAY_MS));
  return `${year}-W${pad(week)}`;
}

/** The period key of the given horizon that contains this day. */
export function periodKeyFor(horizon: Horizon, day: string): string {
  if (horizon === 'day') return day;
  if (horizon === 'week') return weekKeyOf(day);
  return day.slice(0, 7);
}

/* ── period → days ─────────────────────────────────────────────────────── */

/** Monday of an ISO week key. */
function weekStart(weekKey: string): string {
  const [ys, ws] = weekKey.split('-W');
  const year = Number(ys);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = new Date(jan4.getTime() - isoDow(jan4) * DAY_MS);
  return fmtDay(new Date(week1.getTime() + (Number(ws) - 1) * 7 * DAY_MS));
}

/** First day of a period, as a civil date. */
export function periodStart(horizon: Horizon, key: string): string {
  if (horizon === 'day') return key;
  if (horizon === 'week') return weekStart(key);
  return `${key}-01`;
}

/** Last day of a period, as a civil date (inclusive). */
export function periodEnd(horizon: Horizon, key: string): string {
  if (horizon === 'day') return key;
  if (horizon === 'week') return addDays(weekStart(key), 6);
  const [y, m] = key.split('-').map(Number);
  // Day 0 of the next month is the last day of this one — no leap-year table.
  return fmtDay(new Date(Date.UTC(y, m, 0)));
}

/* ── navigation ────────────────────────────────────────────────────────── */

/** The same horizon, `delta` periods away. */
export function shiftPeriod(horizon: Horizon, key: string, delta: number): string {
  if (horizon === 'day') return addDays(key, delta);
  if (horizon === 'week') return weekKeyOf(addDays(weekStart(key), delta * 7));
  const [y, m] = key.split('-').map(Number);
  // Let Date normalise the overflow rather than doing modular arithmetic by
  // hand: month 13 of 2026 is January 2027 and month 0 is December 2025.
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * The horizon above this one, for the period containing `day`.
 *
 * A week's parent is the month containing its THURSDAY, not its Monday — the
 * same midpoint rule ISO uses for the week-year. Without it a week straddling
 * the 1st would belong to two months at once, and its focus items would show
 * up under a goal the operator never set.
 */
export function parentHorizon(horizon: Horizon): Horizon | null {
  return horizon === 'day' ? 'week' : horizon === 'week' ? 'month' : null;
}

export function parentPeriodKey(horizon: Horizon, key: string): string | null {
  if (horizon === 'day') return weekKeyOf(key);
  if (horizon === 'week') return addDays(weekStart(key), 3).slice(0, 7);
  return null;
}

/* ── labels ────────────────────────────────────────────────────────────── */

/** 'September 2026' · 'Week 36 · Aug 31 – Sep 6' · 'Friday, Sep 4' */
export function periodLabel(horizon: Horizon, key: string): string {
  if (horizon === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  if (horizon === 'week') {
    const a = parseDay(periodStart('week', key));
    const b = parseDay(periodEnd('week', key));
    const week = Number(key.split('-W')[1]);
    const left = `${MON_ABBR[a.getUTCMonth()]} ${a.getUTCDate()}`;
    // Drop the repeated month name when the week doesn't cross one.
    const right = a.getUTCMonth() === b.getUTCMonth()
      ? String(b.getUTCDate())
      : `${MON_ABBR[b.getUTCMonth()]} ${b.getUTCDate()}`;
    return `Week ${week} · ${left}–${right}`;
  }
  const d = parseDay(key);
  return `${DAYS[isoDow(d)]}, ${MON_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** 'Today' / 'Yesterday' / 'in 3 days' — the day column's subtitle. */
export function relativeDayLabel(day: string, today: string = todayKey()): string {
  const delta = Math.round((parseDay(day).getTime() - parseDay(today).getTime()) / DAY_MS);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return delta > 0 ? `in ${delta} days` : `${-delta} days ago`;
}

/* ── roll-up ───────────────────────────────────────────────────────────── */

export type PlanNode = { id: string; parent_id: string | null; status: PlanStatus };
export type Progress = { done: number; total: number };

/**
 * done/total for every item, counting ALL descendants, not just direct
 * children — a month goal's real progress lives two levels down in the day
 * tasks, and counting only the week rows under it would report a goal as
 * untouched all month and then finished on the last day.
 *
 * `dropped` descendants are excluded from BOTH halves. Work you decided not to
 * do should neither drag the ratio down nor flatter it by counting as done.
 *
 * Cycles cannot be created through the UI but a hand-edited row could hold
 * one, and an unguarded walk would hang the admin page rather than mis-render
 * a number; `seen` is that guard.
 */
export function rollup(items: PlanNode[]): Map<string, Progress> {
  const children = new Map<string, PlanNode[]>();
  for (const it of items) {
    if (!it.parent_id) continue;
    const list = children.get(it.parent_id);
    if (list) list.push(it); else children.set(it.parent_id, [it]);
  }

  const memo = new Map<string, Progress>();
  const walk = (id: string, seen: Set<string>): Progress => {
    const cached = memo.get(id);
    if (cached) return cached;
    if (seen.has(id)) return { done: 0, total: 0 };
    seen.add(id);

    let done = 0, total = 0;
    for (const child of children.get(id) ?? []) {
      const below = walk(child.id, seen);
      done += below.done;
      total += below.total;
      if (child.status === 'dropped') continue;
      total += 1;
      if (child.status === 'done') done += 1;
    }
    const out = { done, total };
    memo.set(id, out);
    return out;
  };

  const result = new Map<string, Progress>();
  for (const it of items) result.set(it.id, walk(it.id, new Set()));
  return result;
}

/** done/total across one column's own rows, for its header. */
export function columnProgress(items: { status: PlanStatus }[]): Progress {
  const live = items.filter((i) => i.status !== 'dropped');
  return { done: live.filter((i) => i.status === 'done').length, total: live.length };
}
