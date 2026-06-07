/**
 * Pure publish-date scheduling math. Kept free of LLM/DB imports so it's
 * trivially unit-testable and reusable.
 */

/**
 * Spread slots across the month's weekdays at 09:00 UTC. Stored as UTC
 * instants; the dashboard renders them in the viewer's local time. An
 * existing publish_date on a slot is respected (never overwritten).
 */
export function assignPublishDates<T extends { publish_date?: string }>(
  slots: T[], month: string, _postsPerWeek: number,
): T[] {
  if (!slots.length) return slots;
  const [y, m] = month.split('-').map(Number);     // month is 1-based ("2026-06")
  const monthIdx = (m || 1) - 1;
  const daysInMonth = new Date(Date.UTC(y, monthIdx + 1, 0)).getUTCDate();

  const weekdays: number[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = new Date(Date.UTC(y, monthIdx, d)).getUTCDay();
    if (wd !== 0 && wd !== 6) weekdays.push(d);
  }
  if (!weekdays.length) return slots;

  const step = Math.max(1, weekdays.length / slots.length);
  return slots.map((slot, i) => {
    if (slot.publish_date) return slot;
    const day = weekdays[Math.min(weekdays.length - 1, Math.floor(i * step))];
    const dt = new Date(Date.UTC(y, monthIdx, day, 9, 0, 0));
    return { ...slot, publish_date: dt.toISOString() };
  });
}
