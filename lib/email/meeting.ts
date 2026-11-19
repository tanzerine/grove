/**
 * The two meeting-link emails. Pure (no DB, env or network), like
 * lib/email/feedback.ts, so the copy is unit-testable.
 *
 *  - to the OWNER when a prospect answers: every time they picked or
 *    suggested, in the owner's zone with the prospect's beside it, because the
 *    owner decides from a phone and should not have to convert zones.
 *  - to the PROSPECT when the owner confirms: the time in THEIR zone, the
 *    video link, and calendar links.
 *
 * Neither email carries a link that changes state, so a mail scanner that
 * prefetches links can't confirm or cancel anything.
 */
import { formatSlot, meetingSummary, tzCity, type MeetingRow } from '../meetings';

export type ComposedEmail = { subject: string; html: string; text: string };

const INK = '#1c2620';
const MUTE = '#6b7770';
const MOSS = '#59945e';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(inner: string): string {
  return `<div style="font-family:Inter,Helvetica,Arial,sans-serif;color:${INK};max-width:560px;margin:0 auto;padding:24px 8px;line-height:1.55;font-size:15px">${inner}</div>`;
}

function both(iso: string, m: Pick<MeetingRow, 'owner_tz' | 'prospect_tz' | 'duration_min'>): { owner: string; theirs: string | null } {
  const owner = formatSlot(iso, m.owner_tz, m.duration_min);
  const theirs = m.prospect_tz && m.prospect_tz !== m.owner_tz
    ? `${formatSlot(iso, m.prospect_tz, m.duration_min)} for them (${tzCity(m.prospect_tz)})`
    : null;
  return { owner, theirs };
}

export function composeMeetingRequestEmail(m: MeetingRow, adminUrl: string): ComposedEmail {
  const who = m.prospect_org ? `${m.prospect_name} (${m.prospect_org})` : m.prospect_name;
  const picked = m.picked_start ? both(m.picked_start, m) : null;
  const proposals = m.proposed.map((p) => both(p, m));

  const subject = picked
    ? `${who} picked ${formatSlot(m.picked_start!, m.owner_tz, m.duration_min)}`
    : `${who} suggested ${proposals.length === 1 ? 'a new time' : `${proposals.length} new times`}`;

  const lines: string[] = [];
  lines.push(`${who} answered your meeting link for "${m.title}".`);
  if (picked) {
    lines.push('', `Picked: ${picked.owner}`);
    if (picked.theirs) lines.push(`        ${picked.theirs}`);
  }
  if (proposals.length) {
    lines.push('', picked ? 'Also works for them:' : 'None of your times worked. They suggested:');
    for (const p of proposals) lines.push(`- ${p.owner}${p.theirs ? ` · ${p.theirs}` : ''}`);
  }
  if (m.prospect_email) lines.push('', `Email: ${m.prospect_email}`);
  if (m.prospect_note) lines.push('', `Note: ${m.prospect_note}`);
  lines.push('', `Confirm a time: ${adminUrl}`);
  const text = lines.join('\n');

  const slotHtml = (s: { owner: string; theirs: string | null }) =>
    `<div style="font-weight:600">${esc(s.owner)}</div>${s.theirs ? `<div style="color:${MUTE};font-size:13px">${esc(s.theirs)}</div>` : ''}`;

  const html = shell(
    `<p style="margin:0 0 16px">${esc(who)} answered your meeting link for <b>${esc(m.title)}</b>.</p>` +
      (picked
        ? `<div style="border:1px solid #e3e6e1;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-size:12px;color:${MUTE};margin-bottom:4px">Picked</div>${slotHtml(picked)}</div>`
        : '') +
      (proposals.length
        ? `<div style="border:1px solid #e3e6e1;border-radius:12px;padding:14px 16px;margin:0 0 14px"><div style="font-size:12px;color:${MUTE};margin-bottom:6px">${picked ? 'Also works for them' : 'None of your times worked. They suggested'}</div>${proposals.map((p) => `<div style="margin:0 0 8px">${slotHtml(p)}</div>`).join('')}</div>`
        : '') +
      (m.prospect_email ? `<p style="margin:0 0 6px">Email: <a href="mailto:${esc(m.prospect_email)}" style="color:${MOSS}">${esc(m.prospect_email)}</a></p>` : '') +
      (m.prospect_note ? `<p style="margin:0 0 6px;white-space:pre-wrap">Note: ${esc(m.prospect_note)}</p>` : '') +
      `<p style="margin:20px 0 0"><a href="${esc(adminUrl)}" style="background:${MOSS};color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600">Confirm a time</a></p>`,
  );

  return { subject, html, text };
}

export function composeMeetingConfirmedEmail(
  m: MeetingRow,
  links: { pageUrl: string; icsUrl: string; googleUrl: string },
): ComposedEmail {
  if (!m.confirmed_start) throw new Error('meeting is not confirmed');
  const tz = m.prospect_tz || m.owner_tz;
  const when = formatSlot(m.confirmed_start, tz, m.duration_min);
  const subject = `Confirmed: ${meetingSummary(m)} — ${when}`;

  const text = [
    `Hi ${m.prospect_name},`,
    '',
    `You're booked: ${when}${m.prospect_tz ? '' : ` (${tzCity(tz)} time)`}.`,
    m.meeting_url ? `Join: ${m.meeting_url}` : 'The video link will follow before the call.',
    '',
    `Add to Google Calendar: ${links.googleUrl}`,
    `Add to another calendar (.ics): ${links.icsUrl}`,
    `Details or a change of plans: ${links.pageUrl}`,
    '',
    'Talk soon,',
    'Tae · Grove',
  ].join('\n');

  const html = shell(
    `<p style="margin:0 0 14px">Hi ${esc(m.prospect_name)},</p>` +
      `<div style="border:1px solid #e3e6e1;border-radius:12px;padding:16px 18px;margin:0 0 16px">` +
      `<div style="font-size:12px;color:${MUTE};margin-bottom:4px">You're booked</div>` +
      `<div style="font-size:17px;font-weight:600">${esc(when)}</div>` +
      `<div style="color:${MUTE};font-size:13px;margin-top:2px">${esc(meetingSummary(m))} · ${m.duration_min} min</div>` +
      (m.meeting_url
        ? `<p style="margin:12px 0 0"><a href="${esc(m.meeting_url)}" style="color:${MOSS};font-weight:600">Join the call</a></p>`
        : `<p style="margin:12px 0 0;color:${MUTE};font-size:13px">The video link will follow before the call.</p>`) +
      `</div>` +
      `<p style="margin:0 0 6px"><a href="${esc(links.googleUrl)}" style="color:${MOSS}">Add to Google Calendar</a> · <a href="${esc(links.icsUrl)}" style="color:${MOSS}">Add to another calendar (.ics)</a></p>` +
      `<p style="margin:0 0 18px;color:${MUTE};font-size:13px">Details or a change of plans: <a href="${esc(links.pageUrl)}" style="color:${MUTE}">${esc(links.pageUrl)}</a></p>` +
      `<p style="margin:0">Talk soon,<br/>Tae · Grove</p>`,
  );

  return { subject, html, text };
}
