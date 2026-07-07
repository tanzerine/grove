import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Dashboard activity heartbeat. The ActivityPing client component POSTs here
 * on route changes (pageview) and every ~30s while the tab is visible
 * (seconds of attention). Rolls up into one user_activity row per user per
 * UTC day — this is what the admin Users page reads for retention, time
 * spent, and last-seen.
 *
 * Always answers 200 with { ok }: a failed beat (e.g. the 0019 migration not
 * yet applied) must never surface errors in the customer's console.
 */

const body = z.object({
  path: z.string().max(300).optional(),
  seconds: z.number().min(0).max(600).optional(),
  pageview: z.boolean().optional(),
});

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  // sendBeacon posts text/plain — parse the raw body, not req.json().
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(await req.text()));
  } catch {
    return NextResponse.json({ ok: false });
  }

  // Only count time inside the product itself.
  const path = parsed.path && parsed.path.startsWith('/dashboard') ? parsed.path : null;
  const seconds = Math.min(120, Math.round(parsed.seconds ?? 0));
  const pageview = parsed.pageview === true;
  if (seconds <= 0 && !pageview) return NextResponse.json({ ok: true });

  try {
    const { error } = await supabaseAdmin().rpc('bump_user_activity', {
      p_user: user.id,
      p_seconds: seconds,
      p_pageview: pageview,
      p_path: path,
    });
    return NextResponse.json({ ok: !error });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
