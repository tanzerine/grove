import { NextResponse } from 'next/server';
import { rateLimit, LIMITS } from '@/lib/ratelimit';
import { appBase } from '@/lib/seo';
import { ownerNotifyEmail } from '@/lib/admin';
import { sendEmail } from '@/lib/email/resend';
import { composeMeetingRequestEmail } from '@/lib/email/meeting';
import { RESPONSE_ERROR_MESSAGE, publicView, tokenFromSlug, validateResponse } from '@/lib/meetings';
import { meetingByToken, saveResponse } from '@/lib/meetings-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A prospect answers a meeting link: pick an offered time, or suggest their own.
 *
 * Public and unauthenticated — the token in the URL is the whole credential, as
 * with /r/<slug>. So nothing in the body is trusted: lib/meetings validates the
 * pick against the stored slots, and only the owner can confirm. Rate-limited by
 * IP through `rateLimit` directly (not `enforceRateLimit`, which reports the hit
 * to analytics under a user id this caller doesn't have).
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const token = tokenFromSlug((await ctx.params).slug);
  if (!token) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown';
  const limit = await rateLimit(`meet:${ip}`, LIMITS.meet);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many tries. Wait a little and send it again.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec ?? 3600) } },
    );
  }

  const m = await meetingByToken(token);
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) ?? {};
  const v = validateResponse(m, body, new Date());
  if (!v.ok) return NextResponse.json({ error: v.error, message: RESPONSE_ERROR_MESSAGE[v.error] }, { status: 400 });

  let saved;
  try {
    saved = await saveResponse(token, v.value);
  } catch (err) {
    console.error('[meet] save failed:', (err as Error).message);
    return NextResponse.json({ error: 'save_failed', message: 'Something went wrong saving that. Try again.' }, { status: 500 });
  }
  // Null = the owner confirmed or cancelled between page load and this click.
  if (!saved) return NextResponse.json({ error: 'closed', message: RESPONSE_ERROR_MESSAGE.closed }, { status: 409 });

  // Best-effort: the answer is saved and visible on the admin desk either way.
  const mail = composeMeetingRequestEmail(saved, `${appBase()}/dashboard/admin/meetings`);
  await sendEmail({ to: ownerNotifyEmail(), ...mail }).catch(() => null);

  return NextResponse.json({ ok: true, meeting: publicView(saved) });
}
