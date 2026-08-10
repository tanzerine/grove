import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { updateProspect } from '@/lib/outreach/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patch = z.object({
  status: z.enum(['new', 'skipped', 'contacted', 'replied', 'joined']).optional(),
  note: z.string().max(2000).nullable().optional(),
  // The owner edits the draft before sending; storing what was actually sent is
  // the only way the reply rate means anything later.
  dm_subject: z.string().max(300).optional(),
  dm_body: z.string().max(8000).optional(),
});

/** Owner-only: move a prospect through the funnel, or save an edited draft. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await ctx.params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  try {
    const row = await updateProspect(id, parsed.data);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, prospect: row });
  } catch (err) {
    console.error('[admin/outreach] update failed:', (err as Error).message);
    return NextResponse.json({ error: 'update_failed', message: (err as Error).message }, { status: 500 });
  }
}
