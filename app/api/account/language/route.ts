import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { LANG_CODES } from '@/lib/language';
import { UI_LANG_COOKIE, UI_LANG_METADATA_KEY } from '@/lib/i18n';

const schema = z.object({
  locale: z.enum(LANG_CODES as unknown as [string, ...string[]]),
});

/**
 * Set the UI language for the signed-in user.
 *
 * Written in two places on purpose: the cookie makes the next render correct
 * with no database round trip, and the auth metadata makes the choice follow
 * the user to their next device, where there is no cookie yet. The server
 * reads them in that order (lib/i18n/server.ts).
 */
export async function PATCH(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const { locale } = parsed.data;

  // Best-effort: the cookie alone already makes this browser correct, so a
  // metadata write that fails must not fail the request.
  try {
    await sb.auth.updateUser({ data: { [UI_LANG_METADATA_KEY]: locale } });
  } catch { /* cookie still carries it */ }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(UI_LANG_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  return res;
}
