/**
 * 5-step pipeline. Each step independently try/catch'd — failures land in
 * `failed` with `validation.failed_at` so we always know exactly where it died.
 *
 *   1. Site profile          (lazy, one-time per domain)
 *   2. Layered research      (Tavily: primary + competitor + pain)
 *   3. Topic refinement      (NEW — turn raw keyword into a sharp editorial brief)
 *   4. Article write         (executes on the brief)
 *   5. Validate + persist
 */
import { supabaseAdmin } from '../supabase/admin';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { profileSite, type SiteProfile } from './site-profile';
import { gatherContext } from './research-context';
import { refineTopic } from './topic-refiner';
import { fetchCoverImage } from './cover-image';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function failAt(postId: string, step: string, err: any) {
  const msg = String(err?.message ?? err);
  console.error(`generate.${step} failed for ${postId}:`, msg);
  const sb = supabaseAdmin();
  await sb.from('posts').update({
    status: 'failed', validation: { error: msg, failed_at: step },
  }).eq('id', postId);
  throw err;
}

export async function generatePost(postId: string) {
  const sb = supabaseAdmin();
  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;
  const topic: string = post.topic ?? domain.hostname;

  // 1. site profile (lazy)
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
    try {
      profile = await profileSite(domain.hostname);
      await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
    } catch (e) { await failAt(postId, 'site_profile', e); return; }
  }

  // 2. layered research
  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
  let context;
  try { context = await gatherContext(topic, profile); }
  catch (e) { await failAt(postId, 'research', e); return; }

  // 3. topic refinement — turn the keyword into a sharp editorial brief
  let brief;
  try { brief = await refineTopic(topic, profile, context); }
  catch (e) { await failAt(postId, 'topic_refiner', e); return; }

  await sb.from('posts').update({
    status: 'writing',
    research: {
      topic, brief,
      primary: context.primary.map((s) => ({ url: s.url, title: s.title })),
      competitor: context.competitor.map((s) => ({ url: s.url, title: s.title })),
      pain: context.pain.map((s) => ({ url: s.url, title: s.title })),
    },
  }).eq('id', postId);

  // 4. write the article from the brief
  let writer;
  try { writer = await runWriter({ brief, profile, context }); }
  catch (e) { await failAt(postId, 'writer', e); return; }

  if (!writer.blog_post || writer.blog_post.length < 200) {
    await failAt(postId, 'writer_output', new Error(`writer returned ${writer.blog_post.length} chars — too short`));
    return;
  }

  // 5. validate + persist (cover image goes to background after this)
  const title = writer.meta_title || brief.title || topic.slice(0, 60);
  const validation = validatePost(writer.blog_post);
  const slug = slugify(title);
  const nextStatus: 'review' | 'scheduled' = domain.auto_publish ? 'scheduled' : 'review';
  const scheduled_at = domain.auto_publish ? nextPublishSlot(domain.posts_per_week) : null;

  try {
    await sb.from('posts').update({
      status: nextStatus,
      title, slug,
      body_md: writer.blog_post,
      meta_title: writer.meta_title,
      meta_description: writer.meta_description,
      social: null,
      validation,
      scheduled_at,
    }).eq('id', postId);
    await sb.from('topic_memory').insert({ domain_id: domain.id, keyword: topic });
  } catch (e) { await failAt(postId, 'persist', e); return; }

  // 6. cover image — background. Failure is non-fatal; the article is already
  // visible in review and the user can refresh once the image lands.
  fetchCoverImage(title, profile.business.industry)
    .then((cover) => {
      if (!cover) return;
      return sb.from('posts').update({
        cover_image_url: cover.url,
        cover_image_credit: cover.credit,
      }).eq('id', postId);
    })
    .catch((err) => console.error('cover image fetch failed (non-fatal):', err));
}

function nextPublishSlot(perWeek: number): string {
  const intervalHours = Math.max(1, Math.floor((7 * 24) / perWeek));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
