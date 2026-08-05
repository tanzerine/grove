import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { seedLog } from '@/lib/pipeline/log';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { enforceEntitlement } from '@/lib/billing';
import { enforceQuota, releaseQuota } from '@/lib/quota';
import { enforceNotPaused } from '@/lib/kill-switch';
import { dedupeKeyFor, dedupeKeyCandidates, isDedupeCollision, isMissingColumn } from '@/lib/dedupe';
import { captureServer } from '@/lib/analytics/capture-server';

export const maxDuration = 300;

const body = z.object({
  domain_id: z.string().uuid(),
  topic: z.string().min(3),
  /**
   * How long the caller is willing to hold the request open.
   *
   *   wait  (default) — the pipeline runs inside the request; the response
   *                     means the draft is finished. Every existing caller.
   *   queue           — the response comes back as soon as the post exists,
   *                     and the pipeline runs after it. A full generation is
   *                     minutes long, so a UI that awaits `wait` shows a
   *                     spinner until the platform times the request out —
   *                     which is why the Write page asks to be told the id
   *                     up front and follows the run with GET /api/posts/[id].
   */
  mode: z.enum(['wait', 'queue']).optional(),
});

export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
  if (limited) return limited;

  // Platform-wide halt, checked before anything is reserved or spent.
  const halted = await enforceNotPaused();
  if (halted) return halted;

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  const blocked = await enforceEntitlement(user.id, 'generate', sb);
  if (blocked) return blocked;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Idempotency, BEFORE the quota reservation: a double-click must not even
  // reserve a second post, let alone spend one. The lookup covers the common
  // case (the first request already landed); the unique index behind
  // `dedupe_key` covers the case where both requests are in flight at once and
  // neither can see the other yet.
  const dedupeInput = { userId: user.id, domainId: parsed.data.domain_id, topic: parsed.data.topic };
  const candidates = dedupeKeyCandidates(dedupeInput);
  const { data: already } = await sb
    .from('posts').select('id').in('dedupe_key', candidates).limit(1).maybeSingle();
  if (already) return NextResponse.json({ id: already.id, deduped: true });

  // Reserve a post from this month's plan quota before spending anything.
  const over = await enforceQuota(user.id);
  if (over) return over;

  const queue = parsed.data.mode === 'queue';

  const row = {
    domain_id: parsed.data.domain_id,
    // A queued run is claimed here, exactly the way the scheduler claims one:
    // 'researching' + a seeded log. The cron's drain only claims rows still
    // sitting in 'queued', so this is what stops it starting a second
    // generation of the same post while ours runs — and if the platform kills
    // us mid-article the log stops moving, which the same cron recognises as
    // stranded and puts back in the queue. Either way the post finishes.
    status: queue ? 'researching' : 'queued',
    topic: parsed.data.topic,
    ...(queue ? { generation_log: seedLog() } : {}),
  };

  let { data, error } = await sb.from('posts')
    .insert({ ...row, dedupe_key: dedupeKeyFor(dedupeInput) }).select('id').single();
  // dedupe_key lands in migration 0034. If the code is live before the column
  // is, naming it fails the insert outright — which would take draft creation
  // down platform-wide to protect against a double-click. Write it when we can,
  // drop it when we can't (same trade as `planned_by` in lib/strategy/ensure).
  if (error && isMissingColumn(error)) {
    ({ data, error } = await sb.from('posts').insert(row).select('id').single());
  }
  if (error) {
    // The reservation goes back either way — this request is buying nothing.
    await releaseQuota(user.id);
    // Losing the unique index to a concurrent twin is not a failure: the
    // customer's article is being written, just by the other request. Hand back
    // that post's id so both callers watch the same run instead of one of them
    // showing an error for work that is happening.
    if (isDedupeCollision(error)) {
      const { data: winner } = await sb
        .from('posts').select('id').in('dedupe_key', candidates).limit(1).maybeSingle();
      if (winner) return NextResponse.json({ id: winner.id, deduped: true });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // `.single()` types the row as nullable, and the missing-column retry above
  // reassigns it, so TypeScript can no longer see that a null row always
  // arrives alongside an error. Handle it rather than assert past it: a null
  // here would otherwise surface as a crash inside `after()`, after the
  // customer has already been told the draft was accepted.
  if (!data) {
    await releaseQuota(user.id);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  /** Mark the run as failed and hand the plan slot back. */
  const abandon = async (e: any) => {
    // The customer got nothing, so the reservation goes back.
    await releaseQuota(user.id);
    const admin = supabaseAdmin();
    await admin.from('posts').update({
      status: 'failed', validation: { error: String(e?.message ?? e) },
    }).eq('id', data.id);
  };

  await captureServer(user.id, 'post_generation_started', {
    post_id: data.id,
    domain_id: parsed.data.domain_id,
    mode: queue ? 'queue' : 'wait',
  });

  if (queue) {
    // The whole pipeline moves after the response. `after()` keeps the function
    // alive up to maxDuration to finish this — unlike a bare floating promise,
    // which dies the moment the response is returned.
    after(async () => {
      try {
        await generatePost(data.id);
        await runCoverForPost(data.id);
      } catch (e) {
        await abandon(e);
      }
    });
    return NextResponse.json({ id: data.id, queued: true });
  }

  try {
    await generatePost(data.id);
  } catch (e: any) {
    await abandon(e);
    return NextResponse.json({ id: data.id, error: 'generation failed' }, { status: 500 });
  }

  // Cover image runs AFTER the response. Vercel keeps the function alive
  // up to maxDuration to complete `after()` callbacks — unlike a plain
  // fire-and-forget Promise which dies when the function terminates.
  after(async () => { await runCoverForPost(data.id); });

  return NextResponse.json({ id: data.id });
}
