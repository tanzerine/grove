import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { isPeriodKey, HORIZONS, type Horizon } from '@/lib/operator-plan';
import { planBoard, createItem, reorder } from '@/lib/operator-plan-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Owner gate. Returns the failing response, or null when the caller is in. */
async function guard(): Promise<NextResponse | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return null;
}

const dayKey = z.string().refine((s) => isPeriodKey('day', s), 'not a calendar day');

/** The whole board for one anchor day. */
export async function GET(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const anchor = new URL(req.url).searchParams.get('anchor') ?? '';
  const parsed = dayKey.safeParse(anchor);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_anchor' }, { status: 400 });

  return NextResponse.json({ ok: true, board: await planBoard(parsed.data) });
}

const createBody = z.object({
  horizon: z.enum(HORIZONS as [Horizon, ...Horizon[]]),
  period_key: z.string().max(12),
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(4000).nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
}).refine((b) => isPeriodKey(b.horizon, b.period_key), {
  // Validated here rather than left to the DB's text column: a row whose key
  // matches no period is invisible in every view and impossible to notice.
  path: ['period_key'],
  message: 'period_key does not address a period at this horizon',
});

export async function POST(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const parsed = createBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', message: parsed.error.issues[0]?.message }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, item: await createItem(parsed.data) });
  } catch (err) {
    console.error('[admin/plan] create failed:', (err as Error).message);
    return NextResponse.json({ error: 'create_failed', message: (err as Error).message }, { status: 500 });
  }
}

const reorderBody = z.object({ ids: z.array(z.string().uuid()).max(500) });

/** Rewrite one column's order. The whole column is sent — see store.reorder. */
export async function PUT(req: Request) {
  const denied = await guard();
  if (denied) return denied;

  const parsed = reorderBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  try {
    await reorder(parsed.data.ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/plan] reorder failed:', (err as Error).message);
    return NextResponse.json({ error: 'reorder_failed', message: (err as Error).message }, { status: 500 });
  }
}
