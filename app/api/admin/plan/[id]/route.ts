import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { isPeriodKey, PLAN_STATUSES, type PlanStatus, type Horizon } from '@/lib/operator-plan';
import { updateItem, deleteItem } from '@/lib/operator-plan-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function guard(): Promise<NextResponse | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

const patchBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  notes: z.string().max(4000).nullable().optional(),
  status: z.enum(PLAN_STATUSES as [PlanStatus, ...PlanStatus[]]).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  // Moving an item between periods is how carry-over works: the same row is
  // pulled forward rather than copied, so its history and its parent link
  // survive the move and the old day doesn't keep a ghost of it.
  period_key: z.string().max(12).optional(),
  horizon: z.enum(['month', 'week', 'day'] as [Horizon, ...Horizon[]]).optional(),
}).refine((b) => !b.period_key || (b.horizon ? isPeriodKey(b.horizon, b.period_key) : true), {
  path: ['period_key'],
  message: 'period_key must be sent with the horizon it belongs to',
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;

  const { id } = await ctx.params;
  const parsed = patchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'invalid', message: parsed.error?.issues[0]?.message }, { status: 400 });
  }
  // `horizon` rides along only to validate the key; the row's horizon never
  // changes, because a day task promoted to a month goal is a different thing.
  const { horizon: _h, ...patch } = parsed.data;

  try {
    const item = await updateItem(id, patch);
    if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    console.error('[admin/plan] update failed:', (err as Error).message);
    return NextResponse.json({ error: 'update_failed', message: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guard();
  if (denied) return denied;

  const { id } = await ctx.params;
  try {
    await deleteItem(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/plan] delete failed:', (err as Error).message);
    return NextResponse.json({ error: 'delete_failed', message: (err as Error).message }, { status: 500 });
  }
}
