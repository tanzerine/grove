import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { isAdminEmail } from '@/lib/admin';
import { appBase } from '@/lib/seo';
import { normalizeCode, couponProblem, COUPON_PROBLEM_MESSAGE } from '@/lib/beta';
import { couponByCode } from '@/lib/beta-store';
import { harvest } from '@/lib/outreach/reddit';
import { rankProspects, type Tier } from '@/lib/outreach/screen';
import { composeDm, type CouponOffer } from '@/lib/outreach/dm';
import { personalizedDm } from '@/lib/outreach/personalize';
import { knownAuthors, saveProspects, listProspects, type ProspectStatus } from '@/lib/outreach/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A scan is a dozen sequential Reddit requests plus one LLM call per prospect.
export const maxDuration = 300;

/** Hard ceiling on drafts per scan, whatever the caller asks for. */
const MAX_DRAFTS = 20;

const scanBody = z.object({
  subreddits: z.array(z.string().max(40)).max(20).optional(),
  queries: z.array(z.string().max(80)).max(20).optional(),
  time: z.enum(['day', 'week', 'month', 'year', 'all']).optional(),
  maxRequests: z.number().int().min(1).max(30).optional(),
  minTier: z.enum(['strong', 'worth_a_look']).optional(),
  /** How many drafts to write from the ranked list. */
  drafts: z.number().int().min(1).max(MAX_DRAFTS).optional(),
  /** Beta code to offer. Validated before it goes into twenty messages. */
  couponCode: z.string().max(64).optional(),
  /** Off = deterministic openers only: no model calls, no spend, instant. */
  personalize: z.boolean().optional(),
});

/**
 * Owner-only: scan Reddit, screen what comes back, draft a DM for the best.
 *
 * Nothing is sent. The response is a list of drafts a human reads, edits and
 * copies — see lib/outreach/reddit.ts for why there is no send path anywhere in
 * this feature.
 *
 * The coupon is resolved and CHECKED here rather than trusted, because the code
 * is about to be pasted into twenty private messages: offering strangers a code
 * that is expired, exhausted or switched off is worse than offering none, and
 * you would only find out from the first person who tried it.
 */
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = scanBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
  const input = parsed.data;

  /* ── the offer ─────────────────────────────────────────────────────────── */
  let coupon: CouponOffer | null = null;
  if (input.couponCode) {
    const code = normalizeCode(input.couponCode);
    const row = await couponByCode(code);
    const problem = couponProblem(row);
    if (problem) {
      return NextResponse.json(
        { error: 'coupon_unusable', message: `${COUPON_PROBLEM_MESSAGE[problem]} (${code})` },
        { status: 400 },
      );
    }
    coupon = {
      code,
      postsQuota: row!.posts_quota,
      days: row!.days,
      url: `${appBase()}/signup`,
    };
  }

  /* ── find and screen ───────────────────────────────────────────────────── */
  const { posts, queried, errors } = await harvest({
    subreddits: input.subreddits,
    queries: input.queries,
    time: input.time,
    maxRequests: input.maxRequests,
  });

  if (!posts.length) {
    return NextResponse.json(
      {
        ok: false,
        error: 'no_posts',
        message: errors.length
          ? `Reddit returned nothing usable. ${errors[0]}`
          : 'Reddit answered, but no posts matched those queries in that window.',
        scanned: 0, queried: queried.length, errors,
      },
      { status: 502 },
    );
  }

  const already = await knownAuthors();
  const ranked = rankProspects(posts, {
    excludeAuthors: already,
    minTier: (input.minTier ?? 'worth_a_look') as Tier,
  });
  const shortlist = ranked.slice(0, Math.min(input.drafts ?? 10, MAX_DRAFTS));

  /* ── draft ─────────────────────────────────────────────────────────────── */
  const senderName = (user.email ?? '').split('@')[0] || 'me';
  const drafts = [];
  for (const prospect of shortlist) {
    // Sequential: the workhorse is shared with the generation pipeline, and a
    // burst of twenty parallel calls from an admin screen is not worth the
    // contention for a chore nobody is watching.
    const draft = input.personalize === false
      ? { ...composeDm(prospect, { senderName, coupon }), personalized: false }
      : await personalizedDm(prospect, { senderName, coupon });
    drafts.push({ prospect, draft, personalized: draft.personalized, couponCode: coupon?.code ?? null });
  }

  let saved;
  try {
    saved = await saveProspects(drafts);
  } catch (err) {
    console.error('[admin/outreach] save failed:', (err as Error).message);
    return NextResponse.json({ error: 'save_failed', message: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    prospects: saved.saved,
    stats: {
      scanned: posts.length,
      queried: queried.length,
      qualified: ranked.length,
      drafted: drafts.length,
      // Named for what it means to the owner: people we'd already written to.
      alreadyKnown: already.size,
      duplicates: saved.duplicates,
    },
    errors,
  });
}

/** The triage list. `status=open` is everything still awaiting a decision. */
export async function GET(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const status = new URL(req.url).searchParams.get('status');
  const rows = await listProspects({ status: (status ?? undefined) as ProspectStatus | 'open' | undefined });
  return NextResponse.json({ ok: true, prospects: rows });
}
