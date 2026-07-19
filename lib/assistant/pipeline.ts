/**
 * Pure helpers for the assistant's pipeline actions (approve / retry /
 * reschedule): resolve a vague reference like "the draft in review" or
 * "Thursday's post" to a specific row, and parse "to Monday" / "tomorrow at
 * 3pm" into a concrete publish instant. No DB or LLM here — the route feeds
 * these the candidate rows and applies the result. Unit-tested.
 */

export type PostRef = {
  id: string;
  title: string;
  status: string;
  scheduled_at?: string | null;
};

export type Resolution =
  | { kind: 'one'; post: PostRef }
  | { kind: 'many'; posts: PostRef[] }   // ambiguous — the route asks which
  | { kind: 'none' };                    // nothing in the relevant state

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

// Words that carry no selector signal — action verbs, articles, generic nouns.
const STOP = new Set([
  'approve', 'publish', 'ship', 'go', 'live', 'sign', 'off', 'retry', 'regenerate',
  'rerun', 're-run', 'run', 'again', 'reschedule', 'move', 'push', 'delay', 'postpone',
  'the', 'a', 'an', 'my', 'that', 'this', 'it', 'please', 'post', 'posts', 'draft',
  'drafts', 'article', 'articles', 'piece', 'one', 'failed', 'review', 'in', 'to',
  'for', 'on', 'and', 'of', 'about', 'with',
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Match a selector phrase against candidate rows already filtered to the
 * relevant status by the route.
 *
 *  - meaningful title tokens (≥3 chars, non-stopword) score by substring hits
 *  - a weekday word ("thursday's post") matches rows scheduled on that weekday
 *  - no usable selector → fall back to the single-candidate rule
 */
export function resolvePost(selector: string, candidates: PostRef[], now = new Date()): Resolution {
  if (candidates.length === 0) return { kind: 'none' };

  const tokens = tokenize(selector);
  const weekdayHits = new Set(
    tokens.filter((t) => t in WEEKDAYS).map((t) => WEEKDAYS[t]),
  );
  const words = tokens.filter((t) => t.length >= 3 && !STOP.has(t) && !(t in WEEKDAYS));

  if (words.length === 0 && weekdayHits.size === 0) {
    // No selector at all — only unambiguous when exactly one candidate exists.
    return candidates.length === 1 ? { kind: 'one', post: candidates[0] } : { kind: 'many', posts: candidates };
  }

  const scored = candidates.map((c) => {
    const hay = c.title.toLowerCase();
    let score = words.reduce((n, w) => (hay.includes(w) ? n + 1 : n), 0);
    if (weekdayHits.size && c.scheduled_at) {
      const wd = new Date(c.scheduled_at).getUTCDay();
      if (weekdayHits.has(wd)) score += 2;   // a matching scheduled day is a strong signal
    }
    return { c, score };
  });

  const best = Math.max(...scored.map((s) => s.score));
  if (best === 0) {
    // Selector matched nothing — don't guess; single candidate is still safe.
    return candidates.length === 1 ? { kind: 'one', post: candidates[0] } : { kind: 'none' };
  }
  const winners = scored.filter((s) => s.score === best).map((s) => s.c);
  return winners.length === 1 ? { kind: 'one', post: winners[0] } : { kind: 'many', posts: winners };
}

/* ───────────────────────────── date parsing ───────────────────────────── */

export type When = { at: string; label: string };

function atTimeUTC(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/** Pull an "at 3pm" / "at 15:00" / "at 9" time out of the text, default 09:00. */
function parseTime(text: string): { hour: number; minute: number } {
  const m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return { hour: 9, minute: 0 };
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return { hour: 9, minute: 0 };
  return { hour, minute };
}

/**
 * Parse a near-term date phrase to a UTC instant. Handles today / tomorrow /
 * tonight, weekday names (next occurrence, "next friday" jumps a week), and
 * "in N days". Returns null when nothing parses — the route then asks. Note
 * "month"/"week" are deliberately NOT handled (those are plan-revision talk).
 */
export function parseWhen(text: string, now = new Date()): When | null {
  const t = text.toLowerCase();
  const { hour, minute } = parseTime(t);
  const fmtLabel = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  if (/\btoday\b|\btonight\b/.test(t)) {
    const at = atTimeUTC(now, /\btonight\b/.test(t) && !/\bat\b/.test(t) ? 18 : hour, minute);
    return { at: at.toISOString(), label: fmtLabel(at) };
  }
  if (/\btomorrow\b/.test(t)) {
    const base = new Date(now); base.setUTCDate(base.getUTCDate() + 1);
    const at = atTimeUTC(base, hour, minute);
    return { at: at.toISOString(), label: fmtLabel(at) };
  }
  const inDays = t.match(/\bin\s+(\d{1,2})\s+days?\b/);
  if (inDays) {
    const base = new Date(now); base.setUTCDate(base.getUTCDate() + parseInt(inDays[1], 10));
    const at = atTimeUTC(base, hour, minute);
    return { at: at.toISOString(), label: fmtLabel(at) };
  }

  // Longest weekday alias first so "thursday" isn't shadowed by "thu".
  const wdWord = Object.keys(WEEKDAYS)
    .sort((a, b) => b.length - a.length)
    .find((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (wdWord) {
    const target = WEEKDAYS[wdWord];
    let delta = (target - now.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;               // "monday" on a Monday means the next Monday
    if (/\bnext\b/.test(t)) delta += 7;       // "next monday" → the following week
    const base = new Date(now); base.setUTCDate(base.getUTCDate() + delta);
    const at = atTimeUTC(base, hour, minute);
    return { at: at.toISOString(), label: fmtLabel(at) };
  }
  return null;
}

/**
 * Split a reschedule instruction into the target date and the leftover
 * selector phrase. Prefers the clause after to/for/on/until as the target
 * ("move Thursday's post to Monday" → target "Monday", selector "move
 * Thursday's post"); otherwise scans the whole string for a date.
 */
export function extractReschedule(
  instruction: string,
  now = new Date(),
): { when: When | null; selector: string } {
  const prep = instruction.match(/\b(?:to|for|on|until)\s+(.+)$/i);
  if (prep) {
    const when = parseWhen(prep[1], now);
    if (when) {
      return { when, selector: instruction.slice(0, instruction.length - prep[0].length).trim() };
    }
  }
  const when = parseWhen(instruction, now);
  return { when, selector: instruction };
}
