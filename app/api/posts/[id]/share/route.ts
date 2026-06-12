/**
 * POST /api/posts/[id]/share — share a published post to socials on demand.
 *
 * The cron fans out automatically at publish time, but only if auto-share was
 * on and outlets were connected *then*. This route covers everything else:
 * connect an account (or webhook) later, then share the back catalog.
 * Idempotent via posts.social_published — channels that already succeeded
 * are skipped, so mashing the button never double-posts.
 */
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { publishToSocials } from '@/lib/social/publish';
import { runSocialAdapter } from '@/lib/pipeline/writer';

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  // RLS scopes this to the owner's posts.
  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', id).single();
  if (!post) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (post.status !== 'published') {
    return NextResponse.json({ error: 'only published posts can be shared' }, { status: 400 });
  }

  const domain = (post as any).domains;
  const { data: conns } = await sb
    .from('social_connections').select('platform').eq('domain_id', domain.id);
  const hasOutlet = (conns?.length ?? 0) > 0 || !!domain.social_webhook_url;
  if (!hasOutlet) {
    return NextResponse.json(
      { error: 'no outlets — connect an account or add a webhook first' },
      { status: 400 },
    );
  }

  // Make sure channel copy exists before fanning out (mirrors the cron).
  let social = post.social;
  if (!social && domain.site_profile?.business?.name && post.body_md && post.title) {
    try {
      social = await runSocialAdapter({ title: post.title, body_md: post.body_md }, domain.site_profile);
      await supabaseAdmin().from('posts').update({ social }).eq('id', id);
    } catch { /* copy generation failing must not block the share — composeShare falls back to the title */ }
  }

  const result = await publishToSocials(
    domain.id,
    {
      id: post.id, title: post.title, slug: post.slug,
      social, cover_image_url: post.cover_image_url, social_published: post.social_published,
    },
    {
      blog_slug: domain.blog_slug,
      social_webhook_url: domain.social_webhook_url,
      social_webhook_secret: domain.social_webhook_secret,
    },
  );

  return NextResponse.json({ ok: true, result });
}
