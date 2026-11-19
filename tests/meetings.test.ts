/**
 * Meeting links (lib/meetings). The load-bearing rules:
 *
 *  1. A stranger's POST may only pick a time the owner offered, or suggest one
 *     inside the bookable horizon. Nothing else in the body is trusted.
 *  2. Time zones change the LABEL, never the instant. Seoul and Sofia see one
 *     slot; a wall time typed in a zone the page picked converts from THAT zone.
 *  3. The public view never carries the prospect's email.
 */
import { describe, it, expect } from 'vitest';
import {
  MEETING_LIMITS, buildIcs, canRespond, confirmableStart, formatSlot, generateSlots,
  googleCalendarUrl, groupByDay, isMeetingToken, isoToZonedWall, meetingSlug, newMeetingToken,
  normalizeSlots, publicView, safeMeetingUrl, tokenFromSlug, tzOffsetMinutes, validateResponse,
  zonedWallTimeToIso, type MeetingRow,
} from '../lib/meetings';
import { composeMeetingConfirmedEmail, composeMeetingRequestEmail } from '../lib/email/meeting';

const NOW = new Date('2026-11-19T12:00:00Z');
const S1 = '2026-11-24T12:00:00.000Z'; // 21:00 Seoul, 14:00 Sofia
const S2 = '2026-11-24T12:30:00.000Z';

function row(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 'm1', token: 'abcdefghijkmnpqrstuvwxyz', prospect_name: 'Kaloyan', prospect_org: 'Gavri',
    title: 'Grove setup call', duration_min: 30, owner_tz: 'Asia/Seoul', slots: [S1, S2],
    owner_note: null, picked_start: null, proposed: [], prospect_email: null, prospect_tz: null,
    prospect_note: null, responded_at: null, status: 'open', confirmed_start: null, meeting_url: null,
    created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...over,
  };
}

describe('tokens', () => {
  it('mints 24 unambiguous characters', () => {
    const t = newMeetingToken();
    expect(isMeetingToken(t)).toBe(true);
    expect(t).not.toMatch(/[l1o0]/);
    expect(newMeetingToken()).not.toBe(t);
  });

  it('reads the token off a decorated slug, and only a real one', () => {
    const t = 'abcdefghijkmnpqrstuvwxyz';
    expect(meetingSlug(t, 'Gavri AI!')).toBe(`gavri-ai-${t}`);
    expect(tokenFromSlug(`gavri-ai-${t}`)).toBe(t);
    expect(tokenFromSlug(t)).toBe(t);
    expect(tokenFromSlug('gavri')).toBeNull();
    expect(tokenFromSlug('x'.repeat(10) + 'ABCDEFGHIJKMNPQRSTUVWXYZ')).toBeNull();
  });
});

describe('time zones', () => {
  it('knows the offset at the instant', () => {
    expect(tzOffsetMinutes('Asia/Seoul', NOW)).toBe(540);
    expect(tzOffsetMinutes('Europe/Sofia', NOW)).toBe(120);
    expect(tzOffsetMinutes('Europe/Sofia', new Date('2026-07-01T12:00:00Z'))).toBe(180);
  });

  it('converts a wall time from the zone it was typed in, not the browser', () => {
    expect(zonedWallTimeToIso('2026-11-24T14:00', 'Europe/Sofia')).toBe(S1);
    expect(zonedWallTimeToIso('2026-11-24T21:00', 'Asia/Seoul')).toBe(S1);
    expect(zonedWallTimeToIso('nope', 'Asia/Seoul')).toBeNull();
    expect(isoToZonedWall(S1, 'Europe/Sofia')).toBe('2026-11-24T14:00');
  });

  it('labels one instant differently per reader', () => {
    expect(formatSlot(S1, 'Asia/Seoul', 30)).toBe('Tue, Nov 24 · 9:00 PM – 9:30 PM GMT+9');
    expect(formatSlot(S1, 'Europe/Sofia', 30)).toBe('Tue, Nov 24 · 2:00 PM – 2:30 PM GMT+2');
  });

  it('groups by the reader’s calendar day', () => {
    // 23:30 UTC is still Monday in Sofia but Tuesday in Seoul
    const late = '2026-11-23T23:30:00.000Z';
    expect(groupByDay([late], 'Europe/Sofia')[0].label).toBe('Tuesday, Nov 24');
    expect(groupByDay([late], 'America/New_York')[0].label).toBe('Monday, Nov 23');
    expect(groupByDay([S2, S1], 'Asia/Seoul')[0].slots).toEqual([S1, S2]);
  });
});

describe('offered slots', () => {
  it('drops the past and the far future, dedupes and sorts', () => {
    const out = normalizeSlots([S2, S1, S1, '2026-11-01T00:00:00Z', '2027-12-01T00:00:00Z', 'junk'], NOW);
    expect(out).toEqual([S1, S2]);
  });

  it('expands an evening window into slots that END inside it', () => {
    const slots = generateSlots({
      startDate: '2026-11-23', days: 7, from: '20:00', to: '23:00', stepMin: 30,
      durationMin: 30, tz: 'Asia/Seoul', skipWeekends: true,
    }, NOW);
    // Mon–Fri × 20:00, 20:30 … 22:30 = 5 days × 6
    expect(slots).toHaveLength(30);
    expect(isoToZonedWall(slots[0], 'Asia/Seoul')).toBe('2026-11-23T20:00');
    expect(isoToZonedWall(slots[5], 'Asia/Seoul')).toBe('2026-11-23T22:30');
  });
});

describe('a prospect’s answer', () => {
  const ok = { email: 'k@trygavri.com', tz: 'Europe/Sofia' };

  it('accepts an offered pick', () => {
    const v = validateResponse(row(), { ...ok, pick: S1, note: '  see you  ' }, NOW);
    expect(v).toEqual({
      ok: true,
      value: { picked_start: S1, proposed: [], prospect_email: 'k@trygavri.com', prospect_tz: 'Europe/Sofia', prospect_note: 'see you' },
    });
  });

  it('refuses a pick that was never offered', () => {
    expect(validateResponse(row(), { ...ok, pick: '2026-11-25T12:00:00Z' }, NOW)).toEqual({ ok: false, error: 'pick_unavailable' });
  });

  it('accepts suggestions, and refuses past, junk or too many', () => {
    const fut = '2026-11-26T15:00:00.000Z';
    const v = validateResponse(row(), { ...ok, proposed: [fut] }, NOW);
    expect(v.ok && v.value.proposed).toEqual([fut]);
    expect(validateResponse(row(), { ...ok, proposed: ['2026-11-01T00:00:00Z'] }, NOW)).toEqual({ ok: false, error: 'bad_proposal' });
    expect(validateResponse(row(), { ...ok, proposed: ['junk'] }, NOW)).toEqual({ ok: false, error: 'bad_proposal' });
    const four = Array.from({ length: MEETING_LIMITS.proposals + 1 }, (_, i) => `2026-11-2${i + 5}T10:00:00Z`);
    expect(validateResponse(row(), { ...ok, proposed: four }, NOW)).toEqual({ ok: false, error: 'too_many_proposals' });
  });

  it('needs an email and a choice', () => {
    expect(validateResponse(row(), { pick: S1 }, NOW)).toEqual({ ok: false, error: 'email' });
    expect(validateResponse(row(), { ...ok }, NOW)).toEqual({ ok: false, error: 'nothing_chosen' });
  });

  it('drops a bogus time zone instead of storing it', () => {
    const v = validateResponse(row(), { ...ok, tz: 'Mars/Olympus', pick: S1 }, NOW);
    expect(v.ok && v.value.prospect_tz).toBeNull();
  });

  it('closes once the owner confirms or cancels', () => {
    expect(canRespond('requested')).toBe(true);
    expect(validateResponse(row({ status: 'confirmed' }), { ...ok, pick: S1 }, NOW)).toEqual({ ok: false, error: 'closed' });
    expect(validateResponse(row({ status: 'cancelled' }), { ...ok, pick: S1 }, NOW)).toEqual({ ok: false, error: 'closed' });
  });
});

describe('the owner’s confirmation', () => {
  it('only confirms a time either side put on the table', () => {
    const fut = '2026-11-26T15:00:00.000Z';
    const m = row({ status: 'requested', picked_start: S1, proposed: [fut] });
    expect(confirmableStart(m, S2, NOW)).toBe(S2);
    expect(confirmableStart(m, fut, NOW)).toBe(fut);
    expect(confirmableStart(m, '2026-11-27T15:00:00Z', NOW)).toBeNull();
    expect(confirmableStart(row({ status: 'cancelled' }), S1, NOW)).toBeNull();
    expect(confirmableStart(m, S1, new Date('2026-12-01T00:00:00Z'))).toBeNull();
  });

  it('accepts only https video links', () => {
    expect(safeMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(safeMeetingUrl('javascript:alert(1)')).toBeNull();
    expect(safeMeetingUrl('http://zoom.us/j/1')).toBeNull();
  });
});

describe('what leaves the server', () => {
  it('keeps the prospect’s email off the public page', () => {
    const v = publicView(row({ prospect_email: 'k@trygavri.com' })) as Record<string, unknown>;
    expect(v.prospect_email).toBeUndefined();
    expect(v.id).toBeUndefined();
  });

  it('writes a UTC .ics and a Google Calendar link', () => {
    const m = row({ status: 'confirmed', confirmed_start: S1, meeting_url: 'https://meet.google.com/x' });
    const ics = buildIcs(m, S1, 'https://trygroveai.com/meet/x', NOW);
    expect(ics).toContain('DTSTART:20261124T120000Z');
    expect(ics).toContain('DTEND:20261124T123000Z');
    expect(ics).toContain('SUMMARY:Grove setup call · Grove × Gavri');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
    expect(googleCalendarUrl(m, S1, 'https://trygroveai.com/meet/x')).toContain('dates=20261124T120000Z%2F20261124T123000Z');
  });

  it('emails the owner both zones, and escapes what the stranger typed', () => {
    const m = row({
      status: 'requested', picked_start: S1, prospect_tz: 'Europe/Sofia',
      prospect_email: 'k@trygavri.com', prospect_note: '<script>x</script>',
    });
    const mail = composeMeetingRequestEmail(m, 'https://trygroveai.com/dashboard/admin/meetings');
    expect(mail.subject).toBe('Kaloyan (Gavri) picked Tue, Nov 24 · 9:00 PM – 9:30 PM GMT+9');
    expect(mail.text).toContain('2:00 PM – 2:30 PM GMT+2 for them (Sofia)');
    expect(mail.html).not.toContain('<script>');
  });

  it('confirms to the prospect in THEIR zone', () => {
    const m = row({ status: 'confirmed', confirmed_start: S1, prospect_tz: 'Europe/Sofia', prospect_email: 'k@trygavri.com' });
    const mail = composeMeetingConfirmedEmail(m, { pageUrl: 'p', icsUrl: 'i', googleUrl: 'g' });
    expect(mail.subject).toContain('2:00 PM – 2:30 PM GMT+2');
  });
});
