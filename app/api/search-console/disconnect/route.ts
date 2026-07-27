import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { clearConnection } from '@/lib/search-console/client';
import { captureServer } from '@/lib/analytics/capture-server';

export async function POST() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: domain } = await sb
    .from('domains').select('id').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'no_domain' }, { status: 404 });

  await clearConnection(domain.id);
  await captureServer(user.id, 'search_console_disconnected', { domain_id: domain.id });
  return NextResponse.json({ ok: true });
}
