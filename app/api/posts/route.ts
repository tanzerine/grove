import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { seedLog } from '@/lib/pipeline/log';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { canGenerateForUser } from '@/lib/billing';
import { enforceQuota, releaseQuota } from '@/lib/quota';
import { getPostHogClient } from '@/lib/posthog-server';

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

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  if (!(await canGenerateForUser(user.id, sb))) {
    return NextResponse.json(
      { error: 'payment_required', message: 'An active subscription is required to generate content.' },
      { status: 402 },
    );
  }

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb.from('domains').select('id').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Reserve a post from this month's plan quota before spending anything.
  const over = await enforceQuota(user.id);
  if (over) return over;

  const queue = parsed.data.mode === 'queue';

  const { data, error } = await sb.from('posts').insert({
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
  }).select('id').single();
  if (error) {
    await releaseQuota(user.id);
    return NextResponse.json({ error: error.message }, { status: 400 });
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

  const ph = getPostHogClient();
  ph.capture({
    distinctId: user.id,
    event: 'post_generation_started',
    properties: { post_id: data.id, domain_id: parsed.data.domain_id, mode: queue ? 'queue' : 'wait' },
  });
  await ph.flush();

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
