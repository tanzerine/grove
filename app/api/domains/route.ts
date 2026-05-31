import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { makeBlogSlug, normalizeHost } from '@/lib/verify-domain';

const body = z.object({ hostname: z.string().min(3) });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid hostname' }, { status: 400 });

  const hostname = normalizeHost(parsed.data.hostname);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    return NextResponse.json({ error: 'hostname looks malformed' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('domains')
    .insert({ user_id: user.id, hostname, blog_slug: makeBlogSlug(hostname) })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const query = sb.from('domains').select('*').eq('user_id', user.id);
  const { data, error } = id ? await query.eq('id', id).single() : await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
