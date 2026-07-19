/**
 * Dedicated image cron — backfills cover + inline images.
 *
 * Why separate from the scheduler: the scheduler spends most of its 300s
 * budget draining the generation queue (each draft is a slow multi-step LLM
 * run), so the cover/inline backfill at the end of that tick was routinely
 * starved — posts got published with no image, or the cover step was killed
 * mid-run. Giving images their own tick means they always have budget.
 *
 * Newest-first so freshly published posts get their image first. runCoverForPost
 * retries the model call internally, and runInlineImagesForPost is idempotent
 * (it no-ops when images are already present), so this is safe to run often.
 *
 * Runs once a day (Vercel Hobby caps crons at daily) at an hour offset from the
 * scheduler, with the full 300s budget to itself. Immediate needs are covered
 * by the after() paths on create/retry and the manual "Generate cover" button;
 * this drains any backlog and catches posts whose after() never ran.
 *
 * Guarded by CRON_SECRET.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCronAuthorized } from '@/lib/cron-auth';
import { runCoverForPost, MAX_COVER_ATTEMPTS } from '@/lib/pipeline/cover-image';
import { runInlineImagesForPost } from '@/lib/pipeline/inline-images';

export const maxDuration = 300;

// Cover generation is ~1 min each and can retry a couple of times on a bad
// run; keep the count low enough that a slow batch still fits the 300s ceiling
// (covers first — they're what the reader sees in the list and at the top).
// Whatever doesn't fit today is picked up on the next daily run.
const COVER_LIMIT = 4;
const INLINE_LIMIT = 3;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const sb = supabaseAdmin();

  // 1) covers — posts live enough to show but missing a cover, newest first.
  //    Posts that exhausted their retry budget are excluded HERE, not just
  //    guarded inside runCoverForPost — otherwise the same N permanently-
  //    failing posts would fill the whole batch every day and posts behind
  //    them would never get a cover.
  let { data: needCover, error: coverQueryErr } = await sb
    .from('posts')
    .select('id')
    .not('status', 'eq', 'failed')
    .not('status', 'eq', 'queued')
    .is('cover_image_url', null)
    .lt('cover_attempts', MAX_COVER_ATTEMPTS)
    .order('created_at', { ascending: false })
    .limit(COVER_LIMIT);
  if (coverQueryErr) {
    // Pre-migration fallback (0027 not applied → unknown column). The
    // per-post guard is also inert then, so behavior matches today's.
    ({ data: needCover } = await sb
      .from('posts')
      .select('id')
      .not('status', 'eq', 'failed')
      .not('status', 'eq', 'queued')
      .is('cover_image_url', null)
      .order('created_at', { ascending: false })
      .limit(COVER_LIMIT));
  }

  let covers = 0;
  for (const p of needCover ?? []) {
    try {
      await runCoverForPost((p as any).id);
      covers++;
    } catch (e) {
      console.error('[cron/images] cover failed:', (p as any).id, e);
    }
  }

  // 2) inline images — posts that already have a cover, newest first.
  //    runInlineImagesForPost skips ones that already have them.
  const { data: needInline } = await sb
    .from('posts')
    .select('id')
    .not('status', 'eq', 'failed')
    .not('status', 'eq', 'queued')
    .not('cover_image_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(INLINE_LIMIT);

  let inline = 0;
  for (const p of needInline ?? []) {
    try {
      await runInlineImagesForPost((p as any).id);
      inline++;
    } catch (e) {
      console.error('[cron/images] inline failed:', (p as any).id, e);
    }
  }

  return NextResponse.json({ ok: true, covers, inline });
}
