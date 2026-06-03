import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const schema = z.object({
  domain_id: z.string().uuid(),
  auto_publish: z.boolean().optional(),
  posts_per_week: z.number().min(1).max(14).optional(),
});

export async function PATCH(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { domain_id, ...updates } = parsed.data;
  const { error } = await sb.from('domains').update(updates).eq('id', domain_id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
