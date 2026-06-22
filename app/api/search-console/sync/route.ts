import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { syncDomain } from '@/lib/search-console/sync';

/** On-demand refresh of Search Console data for the owner's domain. */
export async function POST() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // GSC's own quota is generous, but a fetch is still an external call — cap it.
  const limited = await enforceRateLimit(`gsc:${user.id}`, LIMITS.crawl);
  if (limited) return limited;

  const { data: domain } = await sb
    .from('domains').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'no_domain' }, { status: 404 });

  const result = await syncDomain(domain.id);
  if (!result.ok) return NextResponse.json({ error: result.reason ?? 'sync_failed' }, { status: 400 });
  return NextResponse.json(result);
}
