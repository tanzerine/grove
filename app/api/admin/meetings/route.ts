import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { MEETING_LIMITS, isValidTimeZone, normalizeSlots } from '@/lib/meetings';
import { createMeeting } from '@/lib/meetings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  prospect_name: z.string().trim().min(1).max(MEETING_LIMITS.name),
  prospect_org: z.string().trim().max(MEETING_LIMITS.name).optional(),
  title: z.string().trim().max(MEETING_LIMITS.title).optional(),
  duration_min: z.number().int().min(10).max(180),
  owner_tz: z.string().refine(isValidTimeZone, 'invalid time zone'),
  slots: z.array(z.string().max(40)).max(MEETING_LIMITS.slots * 2),
  owner_note: z.string().trim().max(MEETING_LIMITS.note).optional(),
});

/** Owner-only: create a meeting link with the times on offer. */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid', message: parsed.error.issues[0]?.message }, { status: 400 });
  const i = parsed.data;

  try {
    const meeting = await createMeeting({
      prospect_name: i.prospect_name,
      prospect_org: i.prospect_org || null,
      title: i.title || 'Intro call',
      duration_min: i.duration_min,
      owner_tz: i.owner_tz,
      slots: normalizeSlots(i.slots, new Date()),
      owner_note: i.owner_note || null,
    });
    return NextResponse.json({ ok: true, meeting });
  } catch (err) {
    console.error('[admin/meetings] create failed:', (err as Error).message);
    return NextResponse.json({ error: 'create_failed', message: (err as Error).message }, { status: 500 });
  }
}
