/**
 * End-to-end generation for a single queued post:
 *   1. ensure we have a site profile for the domain (lazy on first post)
 *   2. research (Tavily web search → LLM brief)
 *   3. write article + SEO meta (site profile injected as deep context)
 *   4. validate prose rules
 *   5. land in 'review' (or 'scheduled' if domain.auto_publish is on)
 *
 * Social variants are NOT generated here — that's on-demand after approval.
 */
import { supabaseAdmin } from '../supabase/admin';
import { runResearch } from './research';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { profileSite, type SiteProfile } from './site-profile';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

export async function generatePost(postId: string) {
  const sb = supabaseAdmin();
  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;

  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);

  // ensure site_profile exists — profile lazily on the first post if not done yet
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    profile = await profileSite(domain.hostname);
    await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
  }

  // research with rich business context — much better keyword interpretation
  const research = await runResearch(
    post.topic ?? domain.hostname,
    `Business: ${profile.business.name} — ${profile.business.description}. ` +
    `Industry: ${profile.business.industry}. ` +
    `Target audience: ${profile.business.target_audience}.`
  );

  await sb.from('posts').update({ status: 'writing', research }).eq('id', postId);

  const writer = await runWriter(research, profile);
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
    social: null,           // generated on demand after approval
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
