/**
 * 5-step pipeline. Each step writes start/done/fail to posts.generation_log
 * so the UI can render a live timeline (no Vercel-logs dig required).
 */
import { supabaseAdmin } from '../supabase/admin';
import { runWriter } from './writer';
import { validatePost } from './validator';
import { profileSite, type SiteProfile } from './site-profile';
import { gatherContext } from './research-context';
import { refineTopic } from './topic-refiner';
import { appendLog, resetLog } from './log';

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function failAt(postId: string, step: any, err: any) {
  const msg = String(err?.message ?? err);
  await appendLog(postId, step, 'fail', msg);
  const sb = supabaseAdmin();
  await sb.from('posts').update({
    status: 'failed', validation: { error: msg, failed_at: step },
  }).eq('id', postId);
  throw err;
}

export async function generatePost(postId: string) {
  const sb = supabaseAdmin();
  await resetLog(postId);
  await appendLog(postId, 'queued', 'done');

  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;
  const topic: string = post.topic ?? domain.hostname;

  // 1. SITE PROFILE (lazy)
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
    await appendLog(postId, 'site_profile', 'start', `crawling ${domain.hostname}`);
    try {
      profile = await profileSite(domain.hostname);
      await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
      await appendLog(postId, 'site_profile', 'done', profile.business.name);
    } catch (e) { await failAt(postId, 'site_profile', e); return; }
  }

  // 2. RESEARCH
  await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
  await appendLog(postId, 'research', 'start', `Tavily x3 for "${topic}"`);
  let context;
  try {
    context = await gatherContext(topic, profile);
    await appendLog(postId, 'research', 'done',
      `${context.primary.length} primary, ${context.competitor.length} competitor, ${context.pain.length} pain`);
  } catch (e) { await failAt(postId, 'research', e); return; }

  // 3. TOPIC REFINER
  await appendLog(postId, 'topic_refiner', 'start', 'picking angle + title');
  let brief;
  try {
    brief = await refineTopic(topic, profile, context);
    await appendLog(postId, 'topic_refiner', 'done', `${brief.format}: ${brief.title}`);
  } catch (e) { await failAt(postId, 'topic_refiner', e); return; }

  await sb.from('posts').update({
    status: 'writing',
    research: {
      topic, brief,
      primary: context.primary.map((s) => ({ url: s.url, title: s.title })),
      competitor: context.competitor.map((s) => ({ url: s.url, title: s.title })),
      pain: context.pain.map((s) => ({ url: s.url, title: s.title })),
    },
  }).eq('id', postId);

  // 4. WRITER
  await appendLog(postId, 'writer', 'start', `drafting ${brief.format}`);
  let writer;
  try {
    writer = await runWriter({ brief, profile, context, hostname: domain.hostname });
    await appendLog(postId, 'writer', 'done', `${writer.blog_post.split(/\s+/).length} words`);
  } catch (e) { await failAt(postId, 'writer', e); return; }

  if (!writer.blog_post || writer.blog_post.length < 200) {
    await failAt(postId, 'writer', new Error(`writer returned ${writer.blog_post.length} chars`));
    return;
  }

  // 5. PERSIST
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
    await appendLog(postId, 'persist', 'done',
      validation.passed ? 'validator passed' : `validator: ${validation.issues.length} flags`);
  } catch (e) { await failAt(postId, 'persist', e); return; }

  // NOTE: cover image is intentionally NOT triggered here.
  // It's scheduled by the API route via Next's after() so it actually runs
  // past the response (fire-and-forget here would die when Vercel terminates
  // the serverless function).
}

function nextPublishSlot(perWeek: number): string {
  const intervalHours = Math.max(1, Math.floor((7 * 24) / perWeek));
  const d = new Date(Date.now() + intervalHours * 3600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}
