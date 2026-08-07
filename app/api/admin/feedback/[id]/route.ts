import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';
import { captureServer } from '@/lib/analytics/capture-server';
import { FEEDBACK_STATUS_CODES, FEEDBACK_LIMITS } from '@/lib/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  status: z.string().refine((s) => (FEEDBACK_STATUS_CODES as string[]).includes(s)).optional(),
  owner_note: z.string().max(FEEDBACK_LIMITS.ownerNote).optional(),
  published: z.boolean().optional(),
});

/**
 * Owner-only triage for one piece of feedback: set its status, keep a private
 * note, or publish a testimonial to the marketing site.
 *
 * Publishing is the only state change here that leaves the building, so it is
 * the only one with a hard precondition: the row must be a testimonial AND the
 * author must have ticked the consent box on that submission. The check lives
 * on the server rather than in the admin UI because "don't quote someone who
 * didn't agree to be quoted" is a promise, not a convenience — a mis-click,
 * a stale page, or a hand-rolled request must all fail the same way.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { status, owner_note, published } = parsed.data;
  if (status === undefined && owner_note === undefined && published === undefined) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from('feedback')
    .select('id, kind, consent_publish, published')
    .eq('id', id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (status !== undefined) patch.status = status;
  if (owner_note !== undefined) patch.owner_note = owner_note.trim() || null;

  if (published !== undefined) {
    if (published) {
      if (row.kind !== 'testimonial') {
        return NextResponse.json(
          { error: 'not_publishable', message: 'Only a testimonial can be published.' },
          { status: 409 },
        );
      }
      if (!row.consent_publish) {
        return NextResponse.json(
          {
            error: 'no_consent',
            message: 'This customer did not agree to be quoted publicly. Ask them first.',
          },
          { status: 409 },
        );
      }
    }
    // Unpublishing is always allowed — withdrawing a quote must never be
    // blocked by the conditions that allowed it to go up.
    patch.published = published;
  }

  // Any owner action counts as having dealt with it; the timestamp is what the
  // customer-facing "we've seen this" state reads from.
  patch.responded_at = new Date().toISOString();
  patch.responded_by = user.email ?? 'admin';

  const { error } = await admin.from('feedback').update(patch).eq('id', id);
  if (error) {
    console.error('[admin/feedback] update error:', error.message);
    return NextResponse.json({ error: 'could not update' }, { status: 500 });
  }

  if (published === true && !row.published) {
    await captureServer(user.id, 'testimonial_published', { feedback_id: id });
  }

  return NextResponse.json({ ok: true });
}
