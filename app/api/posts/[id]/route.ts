import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const { error } = await sb.from('posts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  title: z.string().max(160).optional(),
  body_md: z.string().optional(),
  meta_title: z.string().max(80).optional(),
  meta_description: z.string().max(160).optional(),
  scheduled_at: z.string().nullable().optional(),
  status: z.enum(['review', 'scheduled', 'published']).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === 'published' && !parsed.data.scheduled_at) {
    updates.published_at = new Date().toISOString();
  }

  const { error } = await sb.from('posts').update(updates).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
