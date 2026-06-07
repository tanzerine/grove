/**
 * Hourly cron — runs four responsibilities:
 *   1. publish any 'scheduled' posts whose time has come
 *   2. for verified domains under quota, enqueue new topics
 *   3. drain the 'queued' bucket by generating drafts
 *   4. backfill cover images for posts that are missing one
 *
 * Guarded by CRON_SECRET (Vercel sets x-vercel-cron header; we also accept bearer).
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { runInlineImagesForPost } from '@/lib/pipeline/inline-images';
import { runSocialAdapter } from '@/lib/pipeline/writer';
import { materializeDuePlanSlots } from '@/lib/strategy/materialize';
import { publishToSocials } from '@/lib/social/publish';

export const maxDuration = 300;

function isAuthorized(req: Request) {
  const auth = req.headers.get('authorization');
  const vc = req.headers.get('x-vercel-cron');
  return vc === '1' || auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();

  // 1) publish scheduled posts whose time has come, then fan out to socials
  const now = new Date().toISOString();
  const { data: due } = await sb
    .from('posts')
    .select('id, title, slug, body_md, social, cover_image_url, social_published, domain_id, domains(*)')
    .eq('status', 'scheduled').lte('scheduled_at', now);
  let socialFanout = 0;
  for (const p of due ?? []) {
    await sb.from('posts').update({ status: 'published', published_at: now }).eq('id', p.id);

    const domain = (p as any).domains;
    if (!domain?.auto_social) continue;
    try {
      // generate the social copy on demand if it wasn't created earlier
      let social = (p as any).social;
      if (!social && domain.site_profile?.business?.name && (p as any).body_md && (p as any).title) {
        social = await runSocialAdapter({ title: (p as any).title, body_md: (p as any).body_md }, domain.site_profile);
        await sb.from('posts').update({ social }).eq('id', p.id);
      }
      const res = await publishToSocials(
        (p as any).domain_id,
        {
          id: (p as any).id, title: (p as any).title, slug: (p as any).slug,
          social, cover_image_url: (p as any).cover_image_url, social_published: (p as any).social_published,
        },
        { blog_slug: domain.blog_slug },
      );
      if (Object.values(res).some((r: any) => r?.id)) socialFanout++;
    } catch (e) {
      console.error('[social fanout]', (p as any).id, e);
    }
  }

  // 1b) materialize plan → posts: turn active-strategy slots that are due
  //     (within the lead window) into queued posts, carrying their planned
  //     publish date through. This is what actually executes the strategy.
  let materialized = 0;
  const { data: verified } = await sb
    .from('domains').select('id').not('verified_at', 'is', null);
  for (const d of verified ?? []) {
    try {
      const ids = await materializeDuePlanSlots(d.id, { leadHours: 72, limit: 3 });
      materialized += ids.length;
    } catch { /* one domain failing must not stall the tick */ }
  }

  // 2) drain queued posts (limit 3 per tick to stay under Vercel 300s)
  const { data: queued } = await sb
    .from('posts').select('id').eq('status', 'queued').limit(3);

  for (const p of queued ?? []) {
    try {
      await generatePost(p.id);
    } catch (e: any) {
      await sb.from('posts').update({ status: 'failed', validation: { error: String(e?.message ?? e) } }).eq('id', p.id);
    }
  }

  // 3) backfill cover images — catches posts where after() never ran (e.g. hobby plan)
  const { data: needCover } = await sb
    .from('posts')
    .select('id')
    .not('status', 'eq', 'failed')
    .not('status', 'eq', 'queued')
    .is('cover_image_url', null)
    .limit(3);

  for (const p of needCover ?? []) {
    await runCoverForPost(p.id);
  }

  // 4) backfill inline images — posts that have a cover but not yet inline images
  //    (limit 2 per tick: each post runs 2 Flux calls in parallel, ~10s total)
  const { data: needInline } = await sb
    .from('posts')
    .select('id')
    .not('status', 'eq', 'failed')
    .not('status', 'eq', 'queued')
    .not('cover_image_url', 'is', null)
    .limit(2);

  let inlineCount = 0;
  for (const p of needInline ?? []) {
    await runInlineImagesForPost(p.id);
    inlineCount++;
  }

  return NextResponse.json({
    published: due?.length ?? 0,
    social_fanout: socialFanout,
    materialized,
    generated: queued?.length ?? 0,
    covers: needCover?.length ?? 0,
    inline_images: inlineCount,
  });
}
