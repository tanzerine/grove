/**
 * Pure helpers for the author-facing "when should this go out?" control.
 *
 * The stored field is `posts.scheduled_at` (a UTC instant); the cron in
 * /api/cron/scheduler publishes anything `scheduled` whose time has come. So
 * choosing a publish time is only ever: pick an instant → PATCH scheduled_at +
 * status. Everything here is timezone-aware in the *author's* local zone,
 * because that's what they mean by "tomorrow morning" — and returns UTC ISO,
 * because that's what the column stores.
 *
 * No DB/LLM imports; `now` is injected so it's unit-testable.
 */

export type SchedulePreset = {
  key: 'hour' | 'evening' | 'tomorrow' | 'monday';
  label: string;
  iso: string;
};

/** Morning slot used for day-granularity presets, in the author's local time. */
const MORNING_HOUR = 9;
/** Same-day slot offered while it's still comfortably before it. */
const EVENING_HOUR = 18;

function atLocal(base: Date, addDays: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * The two-to-four choices worth a single click. Always includes "in an hour"
 * and tomorrow morning; adds this evening only while it's still ahead, so the
 * list can never offer a time in the past.
 */
export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
  const out: SchedulePreset[] = [];

  const inAnHour = new Date(now.getTime() + 3600_000);
  inAnHour.setMinutes(0, 0, 0);
  if (inAnHour.getTime() <= now.getTime()) inAnHour.setHours(inAnHour.getHours() + 1);
  out.push({ key: 'hour', label: 'In an hour', iso: inAnHour.toISOString() });

  const evening = atLocal(now, 0, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > 30 * 60_000) {
    out.push({ key: 'evening', label: 'This evening', iso: evening.toISOString() });
  }

  out.push({ key: 'tomorrow', label: 'Tomorrow, 9am', iso: atLocal(now, 1, MORNING_HOUR).toISOString() });

  // Next Monday — a week out when today already is Monday.
  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  out.push({ key: 'monday', label: 'Next Monday, 9am', iso: atLocal(now, daysToMonday, MORNING_HOUR).toISOString() });

  return out;
}

/** `YYYY-MM-DDTHH:mm` in local time — the value shape `<input type="datetime-local">` wants. */
export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type ParsedSchedule = { ok: true; iso: string } | { ok: false; error: string };

/**
 * Validate a datetime-local value (or any parseable date string) into a UTC
 * instant. A past time is rejected rather than silently published on the next
 * tick — "schedule" that publishes immediately is a surprise, not a schedule.
 */
export function parseScheduleInput(value: string, now: Date = new Date()): ParsedSchedule {
  const raw = (value ?? '').trim();
  if (!raw) return { ok: false, error: 'Pick a date and time.' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { ok: false, error: 'That date isn’t valid.' };
  // A minute of slack so clicking "in an hour" a moment later still validates.
  if (d.getTime() < now.getTime() - 60_000) return { ok: false, error: 'Pick a time in the future.' };
  return { ok: true, iso: d.toISOString() };
}

/**
 * Coarse "how far away" label for the schedule button — deliberately coarse so
 * it never disagrees with the exact local time rendered next to it.
 */
export function relativeSchedule(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.round((t - now.getTime()) / 60_000);
  if (mins <= 0) return 'due now';
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `in ${days} day${days === 1 ? '' : 's'}`;
  return `in ${Math.round(days / 7)} weeks`;
}
