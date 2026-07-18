/**
 * Undo for assistant actions — currently title rewrites. The panel posts the
 * revert payload (post_id + the title to restore) that came back with the
 * action. Writes go through the user-scoped client, so RLS enforces
 * ownership on top of the explicit domain check; restoring a title is no
 * more powerful than the editor the owner already has.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({
  domain_id: z.string().uuid(),
  revert: z.array(z.object({
    post_id: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
  })).min(1).max(10),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { domain_id, revert } = parsed.data;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: domain } = await sb
    .from('domains').select('id').eq('id', domain_id).eq('user_id', user.id).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let reverted = 0;
  for (const r of revert) {
    const { error } = await sb.from('posts')
      .update({ title: r.title })
      .eq('id', r.post_id).eq('domain_id', domain_id);
    if (!error) reverted += 1;
  }
  return NextResponse.json({ reverted });
}
