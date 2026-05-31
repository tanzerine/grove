/**
 * End-to-end generation for a single queued post:
 * 1. research (web_search tool)
 * 2. write (web_search tool, voice-aware)
 * 3. validate
 * 4. persist; if domain.auto_publish, schedule for next publish slot; else 'review'.
 */
import { supabaseAdmin } from '../supabase/admin';
import { runResearch } from './research';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { DEFAULT_VOICE } from './writer';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export async function generatePost(postId: string) {
  const sb = supabaseAdmin();
  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;

  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);

  const research = await runResearch(post.topic ?? domain.hostname, `Site: ${domain.hostname}`);

  await sb.from('posts').update({ status: 'writing', research }).eq('id', postId);

  const voice = (domain.brand_voice as any) ?? DEFAULT_VOICE;
  const writer = await runWriter(research, voice);
  const validation = validatePost(writer.blog_post);

  const title = writer.meta_title || research.winning_angle.slice(0, 60);
  const slug = slugify(title);

  const nextStatus: 'review' | 'scheduled' = domain.auto_publish ? 'scheduled' : 'review';
  const scheduled_at = domain.auto_publish ? nextPublishSlot(domain.posts_per_week) : null;

  await sb.from('posts').update({
    status: nextStatus,
    title,
    slug,
    body_md: writer.blog_post,
    meta_title: writer.meta_title,
    meta_description: writer.meta_description,
    social: {
      x: writer.x_thread,
      linkedin: writer.linkedin_post,
      instagram: writer.instagram_caption,
    },
    validation,
    scheduled_at,
  }).eq('id', postId);

  await sb.from('topic_memory').insert({ domain_id: domain.id, keyword: research.keyword });
}

function nextPublishSlot(perWeek: number): string {
  const intervalHours = Math.max(1, Math.floor((7 * 24) / perWeek));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
