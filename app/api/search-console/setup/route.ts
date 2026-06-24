import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { setupStatus } from '@/lib/search-console/setup';

/** Polled by the dashboard to render the right onboarding state (the DNS record
 *  to add, or "verified" once a matching property exists). */
export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: domain } = await sb
    .from('domains').select('id, hostname').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'no_domain' }, { status: 404 });

  return NextResponse.json(await setupStatus(domain.id, domain.hostname));
}
