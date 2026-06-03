/**
 * End-to-end generation for a single queued post.
 * Each step is independently try/catch'd so we never leave a post stuck
 * silently — if any phase dies, the post lands in `failed` with a precise
 * `validation.error` and `validation.failed_at` step name.
 */
import { supabaseAdmin } from '../supabase/admin';
import { runResearch } from './research';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { profileSite, type SiteProfile } from './site-profile';

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

  // ─── 1. SITE PROFILE (lazy on first article) ────────────────────────
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
    try {
      profile = await profileSite(domain.hostname);
      await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
    } catch (e) { await failAt(postId, 'site_profile', e); }
  }

  // ─── 2. RESEARCH ────────────────────────────────────────────────────
  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
  let research;
  try {
    research = await runResearch(
      post.topic ?? domain.hostname,
      `Business: ${profile.business.name} — ${profile.business.description}. ` +
      `Industry: ${profile.business.industry}. ` +
      `Target audience: ${profile.business.target_audience}.`
    );
  } catch (e) { await failAt(postId, 'research', e); return; }

  await sb.from('posts').update({ status: 'writing', research }).eq('id', postId);

  // ─── 3. WRITER ──────────────────────────────────────────────────────
  let writer;
  try {
    writer = await runWriter(research, profile);
  } catch (e) { await failAt(postId, 'writer', e); return; }

  if (!writer.blog_post || writer.blog_post.length < 200) {
    await failAt(postId, 'writer_output', new Error(`writer returned ${writer.blog_post.length} chars — too short`));
    return;
  }

  // ─── 4. VALIDATE + PERSIST ──────────────────────────────────────────
  const validation = validatePost(writer.blog_post);
  const title = writer.meta_title || research.winning_angle.slice(0, 60);
  const slug = slugify(title);
  const nextStatus: 'review' | 'scheduled' = domain.auto_publish ? 'scheduled' : 'review';
  const scheduled_at = domain.auto_publish ? nextPublishSlot(domain.posts_per_week) : null;

  try {
    await sb.from('posts').update({
      status: nextStatus,
      title,
      slug,
      body_md: writer.blog_post,
      meta_title: writer.meta_title,
      meta_description: writer.meta_description,
      social: null,
      validation,
      scheduled_at,
    }).eq('id', postId);
    await sb.from('topic_memory').insert({ domain_id: domain.id, keyword: research.keyword });
  } catch (e) { await failAt(postId, 'persist', e); }
}

function nextPublishSlot(perWeek: number): string {
  const intervalHours = Math.max(1, Math.floor((7 * 24) / perWeek));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
