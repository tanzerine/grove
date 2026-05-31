import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const body = z.object({ domain_id: z.string().uuid(), topic: z.string().min(3) });

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // confirm domain belongs to this user via RLS by select
  const { data: domain } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await sb.from('posts').insert({
    domain_id: parsed.data.domain_id, status: 'queued', topic: parsed.data.topic,
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}
