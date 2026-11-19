/**
 * SERVER-ONLY reads and writes over `meetings` (migration 0046).
 *
 * Split from lib/meetings.ts for the same reason outreach/store is split from
 * screen.ts: the pure module is imported by client components and must never
 * pull in the service-role client.
 *
 * Reads are best-effort and return empty/null rather than throwing, so the admin
 * page renders before 0046 is applied. Writes throw: a booking that silently
 * didn't save is a prospect who thinks they have a call and doesn't.
 */
import { supabaseAdmin } from './supabase/admin';
import { newMeetingToken, type MeetingRow, type MeetingStatus, type ValidResponse } from './meetings';

const COLS =
  'id, token, prospect_name, prospect_org, title, duration_min, owner_tz, slots, owner_note, picked_start, proposed, prospect_email, prospect_tz, prospect_note, responded_at, status, confirmed_start, meeting_url, created_at, updated_at';

/** Postgres hands timestamptz back as "2026-11-24 12:00:00+00"; normalise to ISO. */
function iso(v: string | null): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isoList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((s) => iso(String(s))).filter((s): s is string => !!s) : [];
}

function hydrate(r: any): MeetingRow {
  return {
    ...r,
    slots: isoList(r.slots),
    proposed: isoList(r.proposed),
    picked_start: iso(r.picked_start),
    confirmed_start: iso(r.confirmed_start),
  };
}

export async function listMeetings(limit = 100): Promise<MeetingRow[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('meetings')
      .select(COLS)
      .order('updated_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map(hydrate);
  } catch {
    return [];
  }
}

export async function meetingByToken(token: string): Promise<MeetingRow | null> {
  try {
    const { data } = await supabaseAdmin().from('meetings').select(COLS).eq('token', token).maybeSingle();
    return data ? hydrate(data) : null;
  } catch {
    return null;
  }
}

export async function meetingById(id: string): Promise<MeetingRow | null> {
  try {
    const { data } = await supabaseAdmin().from('meetings').select(COLS).eq('id', id).maybeSingle();
    return data ? hydrate(data) : null;
  } catch {
    return null;
  }
}

export type NewMeeting = {
  prospect_name: string;
  prospect_org: string | null;
  title: string;
  duration_min: number;
  owner_tz: string;
  slots: string[];
  owner_note: string | null;
};

export async function createMeeting(input: NewMeeting): Promise<MeetingRow> {
  const { data, error } = await supabaseAdmin()
    .from('meetings')
    .insert({ ...input, token: newMeetingToken() })
    .select(COLS)
    .single();
  if (error || !data) throw new Error(error?.message ?? 'insert failed');
  return hydrate(data);
}

/**
 * Record the prospect's answer. Guarded on status in the UPDATE itself, so a
 * confirm that lands between the page load and this write can't be undone by
 * a late answer.
 */
export async function saveResponse(token: string, value: ValidResponse): Promise<MeetingRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('meetings')
    .update({ ...value, status: 'requested', responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('token', token)
    .in('status', ['open', 'requested'])
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? hydrate(data) : null;
}

export type MeetingPatch = Partial<{
  status: MeetingStatus;
  confirmed_start: string | null;
  meeting_url: string | null;
  slots: string[];
  owner_note: string | null;
  picked_start: string | null;
  proposed: string[];
}>;

export async function updateMeeting(id: string, patch: MeetingPatch): Promise<MeetingRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('meetings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? hydrate(data) : null;
}
