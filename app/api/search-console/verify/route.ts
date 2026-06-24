import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { verifyAndAdd } from '@/lib/search-console/setup';

/** "I've added the DNS record" → Grove verifies the domain and adds the
 *  property on the user's behalf. */
export async function POST() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Each attempt hits Google's verify endpoint — cap retries.
  const limited = await enforceRateLimit(`gsc:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const { data: domain } = await sb
    .from('domains').select('id, hostname').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'no_domain' }, { status: 404 });

  return NextResponse.json(await verifyAndAdd(domain.id, domain.hostname));
}
