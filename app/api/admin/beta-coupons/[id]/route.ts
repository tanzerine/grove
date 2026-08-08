import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isAdminEmail } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  active: z.boolean().optional(),
  label: z.string().max(120).optional(),
  max_redemptions: z.number().int().min(1).max(100_000).nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  note: z.string().max(500).optional(),
});

/**
 * Owner-only: adjust a live coupon.
 *
 * Deactivating is the kill switch — a code posted somewhere public and picked
 * up by a deals site needs to stop working in one click, without deleting the
 * row and losing the record of who already redeemed it. Grants already made are
 * untouched by design: revoking access someone was promised, because the code
 * later got abused, punishes the wrong person.
 *
 * The code itself is immutable. Changing it would silently strand every printed
 * link and QR pointing at the old value while the redemption history still
 * claimed they were the same campaign; mint a new coupon instead.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.active !== undefined) patch.active = parsed.data.active;
  if (parsed.data.label !== undefined) patch.label = parsed.data.label.trim() || null;
  if (parsed.data.max_redemptions !== undefined) patch.max_redemptions = parsed.data.max_redemptions;
  if (parsed.data.expires_at !== undefined) patch.expires_at = parsed.data.expires_at;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note.trim() || null;
  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: updated, error } = await admin
    .from('beta_coupons')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[admin/beta-coupons] update error:', error.message);
    return NextResponse.json({ error: 'could not update coupon' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return NextResponse.json({ ok: true, coupon: updated });
}
