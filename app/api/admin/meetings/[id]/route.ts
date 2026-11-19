import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { appBase } from '@/lib/seo';
import { sendEmail } from '@/lib/email/resend';
import { composeMeetingConfirmedEmail } from '@/lib/email/meeting';
import {
  MEETING_LIMITS, confirmableStart, googleCalendarUrl, meetingSlug, normalizeSlots, safeMeetingUrl,
} from '@/lib/meetings';
import { meetingById, updateMeeting } from '@/lib/meetings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patch = z.discriminatedUnion('action', [
  // Lock in a time either side put on the table. Re-running it on a confirmed
  // meeting updates the video link and re-sends the confirmation.
  z.object({ action: z.literal('confirm'), start: z.string().max(40), meeting_url: z.string().max(500).optional() }),
  // Replace the offered times and hand the link back to the prospect.
  z.object({ action: z.literal('offer'), slots: z.array(z.string().max(40)).max(MEETING_LIMITS.slots * 2) }),
  z.object({ action: z.literal('cancel') }),
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const p = parsed.data;

  const m = await meetingById(id);
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const now = new Date();

  try {
    if (p.action === 'cancel') {
      const row = await updateMeeting(id, { status: 'cancelled' });
      return NextResponse.json({ ok: true, meeting: row });
    }

    if (p.action === 'offer') {
      const slots = normalizeSlots(p.slots, now);
      if (!slots.length) return NextResponse.json({ error: 'no_slots', message: 'Add at least one future time.' }, { status: 400 });
      const row = await updateMeeting(id, {
        status: 'open', slots, picked_start: null, proposed: [], confirmed_start: null,
      });
      return NextResponse.json({ ok: true, meeting: row });
    }

    // confirm
    const start = confirmableStart(m, p.start, now);
    if (!start) {
      return NextResponse.json(
        { error: 'not_on_table', message: 'That time was not offered or suggested, or it has passed.' },
        { status: 400 },
      );
    }
    let meetingUrl: string | null = m.meeting_url;
    if (p.meeting_url !== undefined) {
      meetingUrl = p.meeting_url.trim() ? safeMeetingUrl(p.meeting_url) : null;
      if (p.meeting_url.trim() && !meetingUrl) {
        return NextResponse.json({ error: 'bad_url', message: 'The video link must be an https:// URL.' }, { status: 400 });
      }
    }
    const row = await updateMeeting(id, { status: 'confirmed', confirmed_start: start, meeting_url: meetingUrl });
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    let emailed: 'sent' | 'skipped' | 'failed' | 'no_address' = 'no_address';
    if (row.prospect_email) {
      const slug = meetingSlug(row.token, row.prospect_org);
      const pageUrl = `${appBase()}/meet/${slug}`;
      const mail = composeMeetingConfirmedEmail(row, {
        pageUrl,
        icsUrl: `${appBase()}/api/meet/${slug}/ics`,
        googleUrl: googleCalendarUrl(row, start, pageUrl),
      });
      const r = await sendEmail({ to: row.prospect_email, ...mail });
      emailed = 'id' in r ? 'sent' : 'skipped' in r ? 'skipped' : 'failed';
    }
    return NextResponse.json({ ok: true, meeting: row, emailed });
  } catch (err) {
    console.error('[admin/meetings] update failed:', (err as Error).message);
    return NextResponse.json({ error: 'update_failed', message: (err as Error).message }, { status: 500 });
  }
}
