import { NextResponse } from 'next/server';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { ACTIVE_DOMAIN_COOKIE } from '@/lib/active-domain';

export const dynamic = 'force-dynamic';

const body = z.object({ id: z.string().uuid() });

// Switch the active site. Ownership is enforced by an RLS-scoped read — a user
// can only switch to a domain they own; anything else 403s and sets no cookie.
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: owned } = await sb
    .from('domains').select('id').eq('id', parsed.data.id).maybeSingle();
  if (!owned) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const jar = await cookies();
  jar.set(ACTIVE_DOMAIN_COOKIE, parsed.data.id, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return NextResponse.json({ ok: true });
}
