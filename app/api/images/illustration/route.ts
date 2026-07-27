/**
 * Generate ONE illustration for the editor, on demand.
 *
 * Domain-scoped rather than post-scoped on purpose: the Write page's canvas is
 * a blank draft that has no post row until the author saves, and an author
 * shouldn't have to save before they can drop a picture into what they're
 * writing. The image lands in Storage; the editor inserts the markdown.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { createIllustration } from '@/lib/images/illustration';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { captureServer } from '@/lib/analytics/capture-server';

export const maxDuration = 120;

const body = z.object({
  domain_id: z.string().uuid(),
  hint: z.string().max(400).optional(),
  selection: z.string().max(2000).optional(),
  heading: z.string().max(300).optional(),
  title: z.string().max(300).optional(),
});

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // Same bucket as covers/inline images — this is the same Replicate spend.
  const limited = await enforceRateLimit(`img:${user.id}`, LIMITS.image);
  if (limited) return limited;

  // RLS-scoped: proves the caller owns the domain before spending credits, and
  // gives the art director the business context it needs to stay on-brand.
  const { data: domain } = await sb
    .from('domains').select('id, site_profile').eq('id', parsed.data.domain_id).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { domain_id: _domainId, ...ctx } = parsed.data;
  const business = (domain as any).site_profile?.business ?? {};

  const image = await createIllustration(ctx, business);
  if (!image) {
    return NextResponse.json(
      { error: 'Could not generate an image — describe what you want illustrated and try again.' },
      { status: 502 },
    );
  }
  await captureServer(user.id, 'illustration_generated', { domain_id: parsed.data.domain_id });
  return NextResponse.json(image);
}
