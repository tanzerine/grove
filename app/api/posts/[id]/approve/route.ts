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
  const { error } = await sb
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Auto-share on publish: the cron only covers *scheduled* posts, so manual
  // approvals fan out here. Best-effort — a flaky social API must never make
  // an approval look failed; per-channel results land in social_published.
  let social_result: Record<string, unknown> | null = null;
  try {
    const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', id).single();
    const domain = (post as any)?.domains;
    if (post && domain?.auto_social) {
      let social = post.social;
      if (!social && domain.site_profile?.business?.name && post.body_md && post.title) {
        try {
          social = await runSocialAdapter({ title: post.title, body_md: post.body_md }, domain.site_profile);
          await supabaseAdmin().from('posts').update({ social }).eq('id', id);
        } catch { /* composeShare falls back to the title */ }
      }
      social_result = await publishToSocials(
        domain.id,
        {
          id: post.id, title: post.title, slug: post.slug,
          social, cover_image_url: post.cover_image_url, social_published: post.social_published,
        },
        {
          blog_slug: domain.blog_slug,
          canonical_blog_base: domain.canonical_blog_base,
          custom_blog_hostname: domain.custom_blog_hostname,
          social_webhook_url: domain.social_webhook_url,
          social_webhook_secret: domain.social_webhook_secret,
        },
      );
    }
  } catch (e) {
    console.error('[approve social fanout]', id, e);
  }

  return NextResponse.json({ ok: true, social_result });
}
