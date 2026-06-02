import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Exchanges the ?code= from Supabase's confirmation email for a session
 * and lands the user on the dashboard (or /onboarding/domain if no domain yet).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (code) {
    const sb = await supabaseServer();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
