/**
 * Meeting links — the rules, as pure functions (migration 0046).
 *
 * The owner offers call times to a prospect at /meet/<token>; the prospect
 * picks one or suggests up to three of their own; the owner confirms. Every
 * rule about what a stranger's POST may change lives here, so it can be tested
 * without a database and the route stays a thin shell around it.
 *
 * Times are stored and compared as ISO UTC strings. Time zones only matter on
 * the way OUT (formatting for a reader); a slot is one instant, and the owner
 * in Seoul and the prospect in Sofia are looking at the same one.
 *
 * Imported by client components too (the booking page, the admin desk), so
 * nothing here touches the service-role client or the environment.
 */

export type MeetingStatus = 'open' | 'requested' | 'confirmed' | 'cancelled';

export const MEETING_LIMITS = {
  slots: 24,          // offered times per link
  proposals: 3,       // times a prospect may suggest instead
  horizonDays: 120,   // nothing bookable further out than this
  note: 1000,
  name: 120,
  title: 120,
  email: 254,
} as const;

/** Everything about a meeting, as the owner sees it. */
export type MeetingRow = {
  id: string;
  token: string;
  prospect_name: string;
  prospect_org: string | null;
  title: string;
  duration_min: number;
  owner_tz: string;
  slots: string[];
  owner_note: string | null;
  picked_start: string | null;
  proposed: string[];
  prospect_email: string | null;
  prospect_tz: string | null;
  prospect_note: string | null;
  responded_at: string | null;
  status: MeetingStatus;
  confirmed_start: string | null;
  meeting_url: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * What the public page may show. Anyone holding the link sees this, so the
 * prospect's email stays out: a forwarded link must not leak an address.
 */
export type PublicMeeting = Omit<MeetingRow, 'id' | 'prospect_email' | 'created_at' | 'updated_at'>;

export function publicView(m: MeetingRow): PublicMeeting {
  const { id: _id, prospect_email: _e, created_at: _c, updated_at: _u, ...rest } = m;
  return rest;
}

/* ── tokens ─────────────────────────────────────────────────────────────── */

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/1/o/0: read aloud safely

/** 24 characters from a 32-letter alphabet: 120 bits, unguessable. */
export function newMeetingToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return out;
}

export function isMeetingToken(s: string): boolean {
  return /^[a-z2-9]{24}$/.test(s);
}

/** Prefix the prospect's name so a shared link reads as theirs, e.g. gavri-x7k… */
export function meetingSlug(token: string, org?: string | null): string {
  const base = (org ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return base ? `${base}-${token}` : token;
}

/** The token is always the last 24 characters; the prefix is decoration. */
export function tokenFromSlug(slug: string): string | null {
  const t = slug.slice(-24);
  return isMeetingToken(t) ? t : null;
}

/* ── time zones ─────────────────────────────────────────────────────────── */

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "GMT+9", "GMT+2" — the offset at that instant, so DST is right. */
export function tzOffsetLabel(tz: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Minutes the zone is ahead of UTC at that instant (Seoul → 540). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock time in a zone ("2026-11-24T14:00" in Europe/Sofia) → ISO UTC.
 *
 * `<input type="datetime-local">` hands back wall time with no zone, and
 * `new Date(value)` would read it in the BROWSER's zone — wrong whenever the
 * reader has picked another zone on the page. Two passes settle DST edges.
 */
export function zonedWallTimeToIso(wall: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(wall);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = guess - tzOffsetMinutes(tz, new Date(guess)) * 60_000;
  t = guess - tzOffsetMinutes(tz, new Date(t)) * 60_000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** ISO UTC → "2026-11-24T14:00" wall time in a zone (for datetime-local inputs). */
export function isoToZonedWall(iso: string, tz: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() + tzOffsetMinutes(tz, d) * 60_000);
  return local.toISOString().slice(0, 16);
}

export type SlotRange = {
  startDate: string;     // "2026-11-23", in `tz`
  days: number;          // how many calendar days from startDate
  from: string;          // "20:00", daily window start in `tz`
  to: string;            // "23:00", daily window end in `tz`
  stepMin: number;       // gap between starts
  durationMin: number;   // a slot must END by `to`
  tz: string;
  skipWeekends: boolean; // weekend as seen in `tz`
};

/**
 * Expand a daily availability window into start times — the Calendly
 * "evenings next week" gesture. A slot is offered only if it ends inside the
 * window, so a 30-minute call in a 20:00–23:00 window starts no later than 22:30.
 */
export function generateSlots(r: SlotRange, now: Date): string[] {
  const d0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.startDate);
  const f = /^(\d{2}):(\d{2})$/.exec(r.from);
  const t = /^(\d{2}):(\d{2})$/.exec(r.to);
  if (!d0 || !f || !t || r.stepMin < 5 || r.days < 1) return [];
  const fromMin = +f[1] * 60 + +f[2];
  const toMin = +t[1] * 60 + +t[2];
  const out: string[] = [];
  for (let i = 0; i < Math.min(r.days, 60); i++) {
    const day = new Date(Date.UTC(+d0[1], +d0[2] - 1, +d0[3] + i));
    const dow = day.getUTCDay();
    if (r.skipWeekends && (dow === 0 || dow === 6)) continue;
    const ymd = day.toISOString().slice(0, 10);
    for (let min = fromMin; min + r.durationMin <= toMin; min += r.stepMin) {
      const hh = String(Math.floor(min / 60)).padStart(2, '0');
      const mm = String(min % 60).padStart(2, '0');
      const iso = zonedWallTimeToIso(`${ymd}T${hh}:${mm}`, r.tz);
      if (iso) out.push(iso);
    }
  }
  return normalizeSlots(out, now, 500);
}

/** "Europe/Sofia" → "Sofia". */
export function tzCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return last.replace(/_/g, ' ');
}

/* ── slots ──────────────────────────────────────────────────────────────── */

function toIso(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/**
 * Clean a list of offered start times: parse, round to the minute, drop the
 * past and anything beyond the horizon, dedupe, sort, cap.
 */
export function normalizeSlots(input: unknown[], now: Date, cap: number = MEETING_LIMITS.slots): string[] {
  const max = now.getTime() + MEETING_LIMITS.horizonDays * 86_400_000;
  const seen = new Set<string>();
  for (const v of input) {
    const iso = toIso(v);
    if (!iso) continue;
    const t = Math.floor(Date.parse(iso) / 60_000) * 60_000;
    if (t <= now.getTime() || t > max) continue;
    seen.add(new Date(t).toISOString());
  }
  return [...seen].sort().slice(0, cap);
}

/** Offered slots still in the future — the only ones a reader may pick. */
export function upcomingSlots(slots: string[], now: Date): string[] {
  return slots.filter((s) => Date.parse(s) > now.getTime()).sort();
}

export type DayGroup = { key: string; label: string; slots: string[] };

/** Group start times by calendar day IN THE READER'S ZONE. */
export function groupByDay(slots: string[], tz: string): DayGroup[] {
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const labelFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });
  const groups = new Map<string, DayGroup>();
  for (const s of [...slots].sort()) {
    const d = new Date(s);
    const key = keyFmt.format(d);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: labelFmt.format(d), slots: [] };
      groups.set(key, g);
    }
    g.slots.push(s);
  }
  return [...groups.values()];
}

export function formatTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Tue, Nov 24 · 2:00 PM – 2:30 PM GMT+2" */
export function formatSlot(iso: string, tz: string, durationMin: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  return `${day} · ${formatTime(start.toISOString(), tz)} – ${formatTime(end.toISOString(), tz)} ${tzOffsetLabel(tz, start)}`;
}

/* ── the prospect's answer ──────────────────────────────────────────────── */

export function canRespond(status: MeetingStatus): boolean {
  // Changing your mind is allowed until the owner confirms.
  return status === 'open' || status === 'requested';
}

export type ResponseInput = {
  pick?: unknown;
  proposed?: unknown;
  email?: unknown;
  tz?: unknown;
  note?: unknown;
};

export type ResponseError =
  | 'closed'
  | 'email'
  | 'nothing_chosen'
  | 'pick_unavailable'
  | 'bad_proposal'
  | 'too_many_proposals';

export const RESPONSE_ERROR_MESSAGE: Record<ResponseError, string> = {
  closed: 'This link is no longer taking answers.',
  email: 'Add an email address so the confirmation can reach you.',
  nothing_chosen: 'Pick a time, or suggest one that works for you.',
  pick_unavailable: 'That time is no longer available. Pick another.',
  bad_proposal: 'One of the suggested times is in the past or too far out.',
  too_many_proposals: `Suggest at most ${MEETING_LIMITS.proposals} times.`,
};

export type ValidResponse = {
  picked_start: string | null;
  proposed: string[];
  prospect_email: string;
  prospect_tz: string | null;
  prospect_note: string | null;
};

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MEETING_LIMITS.email && EMAIL_RE.test(v);
}

/**
 * Decide what a prospect's POST may write. Nothing from the request is taken
 * on trust: a pick must be one of the still-upcoming offered slots, and a
 * suggestion must land inside the bookable horizon.
 */
export function validateResponse(
  m: Pick<MeetingRow, 'status' | 'slots'>,
  input: ResponseInput,
  now: Date,
): { ok: true; value: ValidResponse } | { ok: false; error: ResponseError } {
  if (!canRespond(m.status)) return { ok: false, error: 'closed' };

  const email = typeof input.email === 'string' ? input.email.trim() : '';
  if (!isEmail(email)) return { ok: false, error: 'email' };

  let picked: string | null = null;
  if (input.pick != null && input.pick !== '') {
    const iso = toIso(input.pick);
    if (!iso || !upcomingSlots(m.slots, now).includes(iso)) return { ok: false, error: 'pick_unavailable' };
    picked = iso;
  }

  const rawProposed = Array.isArray(input.proposed) ? input.proposed.filter((v) => v !== '' && v != null) : [];
  if (rawProposed.length > MEETING_LIMITS.proposals) return { ok: false, error: 'too_many_proposals' };
  const proposed = normalizeSlots(rawProposed, now, MEETING_LIMITS.proposals);
  if (proposed.length !== new Set(rawProposed.map((v) => toIso(v))).size) return { ok: false, error: 'bad_proposal' };

  if (!picked && proposed.length === 0) return { ok: false, error: 'nothing_chosen' };

  const note = typeof input.note === 'string' ? input.note.trim().slice(0, MEETING_LIMITS.note) : '';
  return {
    ok: true,
    value: {
      picked_start: picked,
      // A pick wins: suggestions alongside a pick are kept as alternatives.
      proposed,
      prospect_email: email.toLowerCase(),
      prospect_tz: isValidTimeZone(input.tz) ? input.tz : null,
      prospect_note: note || null,
    },
  };
}

/* ── the owner's confirmation ───────────────────────────────────────────── */

/**
 * The owner may confirm any time either side put on the table — an offered
 * slot, the prospect's pick, or one of their suggestions — as long as it is
 * still ahead. Anything else is a new offer, not a confirmation.
 */
export function confirmableStart(
  m: Pick<MeetingRow, 'status' | 'slots' | 'picked_start' | 'proposed'>,
  start: string,
  now: Date,
): string | null {
  if (m.status === 'cancelled') return null;
  const iso = toIso(start);
  if (!iso || Date.parse(iso) <= now.getTime()) return null;
  const onTable = new Set([...m.slots, ...m.proposed, ...(m.picked_start ? [m.picked_start] : [])]);
  return onTable.has(iso) ? iso : null;
}

/** Only https video links: the URL is rendered as a link on a public page. */
export function safeMeetingUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ── calendar output ────────────────────────────────────────────────────── */

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function meetingSummary(m: Pick<MeetingRow, 'title' | 'prospect_org' | 'prospect_name'>): string {
  const who = m.prospect_org || m.prospect_name;
  return who ? `${m.title} · Grove × ${who}` : m.title;
}

/** A one-event .ics a calendar app can import. UTC throughout: no VTIMEZONE needed. */
export function buildIcs(
  m: Pick<MeetingRow, 'token' | 'title' | 'prospect_org' | 'prospect_name' | 'duration_min' | 'meeting_url'>,
  start: string,
  pageUrl: string,
  now: Date,
): string {
  const s = new Date(start);
  const e = new Date(s.getTime() + m.duration_min * 60_000);
  const desc = [m.meeting_url ? `Join: ${m.meeting_url}` : null, `Details: ${pageUrl}`].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Grove//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.token}@trygroveai.com`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(s)}`,
    `DTEND:${icsStamp(e)}`,
    `SUMMARY:${icsEscape(meetingSummary(m))}`,
    `DESCRIPTION:${icsEscape(desc)}`,
    ...(m.meeting_url ? [`LOCATION:${icsEscape(m.meeting_url)}`] : []),
    `URL:${pageUrl}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function googleCalendarUrl(
  m: Pick<MeetingRow, 'title' | 'prospect_org' | 'prospect_name' | 'duration_min' | 'meeting_url'>,
  start: string,
  pageUrl: string,
): string {
  const s = new Date(start);
  const e = new Date(s.getTime() + m.duration_min * 60_000);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: meetingSummary(m),
    dates: `${icsStamp(s)}/${icsStamp(e)}`,
    details: [m.meeting_url ? `Join: ${m.meeting_url}` : null, `Details: ${pageUrl}`].filter(Boolean).join('\n'),
    ...(m.meeting_url ? { location: m.meeting_url } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
