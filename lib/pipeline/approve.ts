/**
 * Approve-and-publish — the core of POST /api/posts/[id]/approve, extracted so
 * the pipeline UI and the sidebar assistant publish through ONE code path
 * (status flip + best-effort social fan-out) and can't drift apart.
 *
 * The caller passes a user-scoped Supabase client, so RLS enforces ownership;
 * the social-copy backfill writes with the service role exactly as before.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin';
import { ensurePostSlug } from '../post-slug';
import { publishToSocials } from '../social/publish';
import { runSocialAdapter } from './writer';
import { captureServer } from '../analytics/capture-server';
import { languageForDomain } from '../language';

export async function approveAndPublish(
  sb: SupabaseClient,
  id: string,
): Promise<{ ok: boolean; social_result: Record<string, unknown> | null; error?: string }> {
  // Hand-written drafts (Write page) have no slug until something publishes
  // them — without this the live URL, canonical, sitemap and share links all
  // point at a slug-less path. No-op for pipeline posts, which already have one.
  await ensurePostSlug(sb, id);

  const { error } = await sb
    .from('posts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, social_result: null, error: error.message };

  // Captured here rather than in the two calling routes precisely because this
  // function exists to stop the pipeline UI and the assistant from drifting —
  // the same reasoning applies to the metric. `scheduled: false` because this
  // path is only ever reached by a person clicking approve; the cron publishes
  // its own way. The client is user-scoped, so it can tell us whose action it is.
  try {
    const { data: auth } = await sb.auth.getUser();
    if (auth.user) {
      await captureServer(auth.user.id, 'post_published', { post_id: id, scheduled: false });
    }
  } catch { /* never let analytics fail a publish that already succeeded */ }

  // Auto-share on publish: the cron only covers *scheduled* posts, so manual
  // approvals fan out here. Best-effort — a flaky social API must never make an
  // approval look failed; per-channel results land in social_published.
  let social_result: Record<string, unknown> | null = null;
  try {
    const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', id).single();
    const domain = (post as any)?.domains;
    if (post && domain?.auto_social) {
      let social = (post as any).social;
      if (!social && domain.site_profile?.business?.name && (post as any).body_md && (post as any).title) {
        try {
          social = await runSocialAdapter({ title: (post as any).title, body_md: (post as any).body_md }, domain.site_profile, languageForDomain(domain).code);
          await supabaseAdmin().from('posts').update({ social }).eq('id', id);
        } catch { /* composeShare falls back to the title */ }
      }
      social_result = await publishToSocials(
        domain.id,
        {
          id: (post as any).id, title: (post as any).title, slug: (post as any).slug,
          social, cover_image_url: (post as any).cover_image_url, social_published: (post as any).social_published,
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

  return { ok: true, social_result };
}
