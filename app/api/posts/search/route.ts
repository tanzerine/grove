import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { getActiveDomain } from '@/lib/active-domain';
import { orFilter, queryTokens, searchPosts, SEARCH_FIELDS, type SearchablePost } from '@/lib/post-search';

export const dynamic = 'force-dynamic';

const COLUMNS = ['id', 'status', 'published_at', 'scheduled_at', 'created_at', ...SEARCH_FIELDS].join(', ');
const MAX_CANDIDATES = 400;
const MAX_RESULTS = 8;

/**
 * Article search behind the dashboard search bar. Scoped to the active site —
 * the same site every other dashboard page is showing — and to the signed-in
 * user by RLS on top of that.
 *
 * The DB filter is a loose OR union (any token, any field); the pure ranker in
 * lib/post-search applies AND semantics and decides the order.
 */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().slice(0, 120);
  const or = orFilter(queryTokens(q));
  if (!or) return NextResponse.json({ results: [], total: 0 });

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const domain = await getActiveDomain(sb);
  if (!domain) return NextResponse.json({ results: [], total: 0 });

  const { data, error } = await sb
    .from('posts')
    .select(COLUMNS)
    .eq('domain_id', domain.id)
    .or(or)
    .order('created_at', { ascending: false })
    .limit(MAX_CANDIDATES);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const ranked = searchPosts((data ?? []) as unknown as SearchablePost[], q);
  return NextResponse.json({ results: ranked.slice(0, MAX_RESULTS), total: ranked.length });
}
