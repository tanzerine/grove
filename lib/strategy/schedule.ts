/**
 * Pure publish-date scheduling math. Kept free of LLM/DB imports so it's
 * trivially unit-testable and reusable.
 */

/** Every planned slot publishes at 09:00 UTC on its day. */
export const PUBLISH_HOUR_UTC = 9;

function isWeekday(y: number, monthIdx: number, day: number): boolean {
  const wd = new Date(Date.UTC(y, monthIdx, day)).getUTCDay();
  return wd !== 0 && wd !== 6;
}

/**
 * The days of `month` a plan may still publish on, counting from `now`.
 *
 * A plan built mid-month must not schedule into the past. It used to spread
 * across every weekday of the month regardless of the date, so a plan built on
 * the 26th put two thirds of its calendar behind it — and those slots weren't
 * merely ugly: `materializeDuePlanSlots` treats anything dated within its lead
 * window as due, so the whole backlog became posts at once, back-dated.
 *
 * Day numbers are 1-based and may exceed the month's length, which is how the
 * last-day case runs into the next weekday instead of backwards (Date.UTC rolls
 * the overflow over for us). A month that hasn't started — the monthly cron's
 * normal case, building on the 1st — is untouched, and so is a month already
 * over, so a historic rebuild keeps its original shape.
 */
export function publishableDays(month: string, now: Date = new Date()): number[] {
  const [y, m] = month.split('-').map(Number);
  const monthIdx = (m || 1) - 1;
  const daysInMonth = new Date(Date.UTC(y, monthIdx + 1, 0)).getUTCDate();

  const current = now.getUTCFullYear() === y && now.getUTCMonth() === monthIdx;
  // Today still counts until its 09:00 slot has gone by.
  const first = current
    ? now.getUTCDate() + (now.getUTCHours() >= PUBLISH_HOUR_UTC ? 1 : 0)
    : 1;

  const days: number[] = [];
  for (let d = first; d <= daysInMonth; d++) {
    if (isWeekday(y, monthIdx, d)) days.push(d);
  }
  if (days.length) return days;

  // Built on (or after) the month's last usable day: the soonest weekday ahead
  // beats a date in the past, even though it lands in the next month.
  for (let d = Math.max(first, daysInMonth + 1); d <= daysInMonth + 7; d++) {
    if (isWeekday(y, monthIdx, d)) return [d];
  }
  return [daysInMonth];
}

/**
 * How many slots a plan for `month` should hold, given the cadence and when it
 * is being built.
 *
 * A full month's worth of posts planned on the 26th is not a plan: either the
 * dates are in the past, or — once they're clamped forward — a fortnight of
 * work is crammed into four days, which the quota would refuse anyway. So a
 * mid-month plan is pro-rated to the weekdays the month has left, and the 1st
 * brings a full one.
 */
export function slotsForRemainder(postsPerWeek: number, month: string, now: Date = new Date()): number {
  const days = publishableDays(month, now);
  const perWeek = Number.isFinite(postsPerWeek) && postsPerWeek > 0 ? postsPerWeek : 4;
  const perWeekday = perWeek / 5;                 // the cadence, spread over a work week
  return Math.max(1, Math.min(days.length, Math.round(days.length * perWeekday)));
}

/**
 * Spread slots across the month's publishable weekdays at 09:00 UTC. Stored as
 * UTC instants; the dashboard renders them in the viewer's local time. An
 * existing publish_date on a slot is respected (never overwritten).
 */
/**
 * Next auto-publish instant for a domain publishing `perWeek` posts/week:
 * now + one cadence interval, snapped to the top of the hour. Tolerates
 * 0/null/garbage cadence (legacy rows) by falling back to the column default
 * of 4/week — an approved draft must never fail its final persist because the
 * interval math produced an Invalid Date (168/0 = Infinity → toISOString throws).
 */
export function nextPublishSlot(perWeek: number | null | undefined): string {
  const per = Number(perWeek);
  const safe = Number.isFinite(per) && per > 0 ? per : 4;
  const intervalHours = Math.max(1, Math.floor((7 * 24) / safe));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export function assignPublishDates<T extends { publish_date?: string }>(
  slots: T[], month: string, _postsPerWeek: number, now: Date = new Date(),
): T[] {
  if (!slots.length) return slots;
  const [y, m] = month.split('-').map(Number);     // month is 1-based ("2026-06")
  const monthIdx = (m || 1) - 1;

  const days = publishableDays(month, now);
  if (!days.length) return slots;

  const step = Math.max(1, days.length / slots.length);
  return slots.map((slot, i) => {
    if (slot.publish_date) return slot;
    const day = days[Math.min(days.length - 1, Math.floor(i * step))];
    const dt = new Date(Date.UTC(y, monthIdx, day, PUBLISH_HOUR_UTC, 0, 0));
    return { ...slot, publish_date: dt.toISOString() };
  });
}
