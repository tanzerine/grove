/**
 * Linear 4-step pipeline. Each step is independently try/catch'd so a failure
 * never leaves a post stuck — it lands in `failed` with the precise step.
 */
import { supabaseAdmin } from '../supabase/admin';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { profileSite, type SiteProfile } from './site-profile';
import { gatherContext } from './research-context';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function failAt(postId: string, step: string, err: any) {
  const msg = String(err?.message ?? err);
  console.error(`generate.${step} failed for ${postId}:`, msg);
  const sb = supabaseAdmin();
  await sb.from('posts').update({
    status: 'failed',
    validation: { error: msg, failed_at: step },
  }).eq('id', postId);
  throw err;
}

export async function generatePost(postId: string) {
  const sb = supabaseAdmin();
  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;
  const topic: string = post.topic ?? domain.hostname;

  // 1. site profile
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
    try {
      profile = await profileSite(domain.hostname);
      await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
    } catch (e) { await failAt(postId, 'site_profile', e); return; }
  }

  // 2. layered research context (primary + competitor + pain in parallel)
  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
  let context;
  try { context = await gatherContext(topic, profile); }
  catch (e) { await failAt(postId, 'research', e); return; }

  await sb.from('posts').update({
    status: 'writing',
    research: {
      topic,
      primary: context.primary.map((s) => ({ url: s.url, title: s.title })),
      competitor: context.competitor.map((s) => ({ url: s.url, title: s.title })),
      pain: context.pain.map((s) => ({ url: s.url, title: s.title })),
    },
  }).eq('id', postId);

  // 3. writer
  let writer;
  try { writer = await runWriter({ topic, profile, context }); }
  catch (e) { await failAt(postId, 'writer', e); return; }

  if (!writer.blog_post || writer.blog_post.length < 200) {
    await failAt(postId, 'writer_output', new Error(`writer returned ${writer.blog_post.length} chars — too short`));
    return;
  }

  // 4. validate + persist
  const validation = validatePost(writer.blog_post);
  const title = writer.meta_title || topic.slice(0, 60);
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
  } catch (e) { await failAt(postId, 'persist', e); }
}

function nextPublishSlot(perWeek: number): string {
  const intervalHours = Math.max(1, Math.floor((7 * 24) / perWeek));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
