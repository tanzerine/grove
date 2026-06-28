import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';

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

    // Carry the referral answer from the pre-redirect cookie into user
    // metadata — only set it once, never overwrite an existing value.
    const jar = await cookies();
    const ref = jar.get('grove_ref')?.value;
    if (ref) {
      const { data } = await sb.auth.getUser();
      if (data.user && !data.user.user_metadata?.referral_source) {
        await sb.auth.updateUser({ data: { referral_source: decodeURIComponent(ref) } });
      }
      jar.delete('grove_ref');
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
