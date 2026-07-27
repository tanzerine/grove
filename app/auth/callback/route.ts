import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { captureServer } from '@/lib/analytics/capture-server';

/**
 * Exchanges the ?code= from Supabase (email confirmation OR Google OAuth)
 * for a session and lands the user on the dashboard (or /onboarding/domain
 * if no domain yet). Also persists the "how did you hear about us" answer
 * stashed in the grove_ref cookie before the OAuth round-trip.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (code) {
    const sb = await supabaseServer();
    await sb.auth.exchangeCodeForSession(code);

    const { data } = await sb.auth.getUser();
    const user = data.user;

    // Carry the referral answer from the pre-redirect cookie into user
    // metadata — only set it once, never overwrite an existing value.
    const jar = await cookies();
    const ref = jar.get('grove_ref')?.value;
    if (ref) {
      if (user && !user.user_metadata?.referral_source) {
        await sb.auth.updateUser({ data: { referral_source: decodeURIComponent(ref) } });
      }
      jar.delete('grove_ref');
    }

    // Google is the one path AuthForm cannot instrument — the browser leaves
    // for Google before any result exists, so the session first becomes real
    // here.
    if (user && user.app_metadata?.provider === 'google') {
      // No "is this a new user?" flag exists on the session, so infer it from
      // the account's age. A first OAuth round-trip takes seconds; anything
      // older than a minute is someone signing back in.
      const isNew = Date.now() - Date.parse(user.created_at) < 60_000;
      if (isNew) {
        await captureServer(user.id, 'signed_up', {
          method: 'google',
          confirmation_required: false, // OAuth arrives pre-verified
        });
      } else {
        await captureServer(user.id, 'signed_in', { method: 'google' });
      }
    } else if (user) {
      // An email/password user reaching this route arrived by clicking a
      // confirmation link — nothing else sends them here with a code.
      //
      // This is the other half of the launch's most important funnel.
      // `signed_up{confirmation_required:true}` says an account was created
      // and parked behind the email wall; this says they got through it.
      // Without it the wall's completion rate is unobservable, which is
      // exactly the blind spot that made the confirmation path risky to
      // launch on. NOT captured as `signed_up` — AuthForm already counted
      // that, and doing it here too would double every email signup.
      await captureServer(user.id, 'email_confirmed', {});
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
