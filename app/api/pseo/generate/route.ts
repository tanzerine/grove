import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { generateProgrammaticPage, type PseoPageSpec } from '@/lib/pseo';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import type { SiteProfile } from '@/lib/pipeline/site-profile';
import { enforceEntitlement } from '@/lib/billing';
import { consumeQuota, releaseQuota, exhaustedMessage } from '@/lib/quota';
import { languageForDomain } from '@/lib/language';
import { randomUUID } from 'crypto';
import { postSlug } from '@/lib/slug';

export const maxDuration = 300;

const intent = z.enum(['informational', 'commercial', 'transactional', 'navigational']);
const body = z.object({
  domain_id: z.string().uuid(),
  pages: z.array(z.object({
    keyword: z.string().min(2).max(120),
    title: z.string().min(2).max(160),
    intent,
  })).min(1).max(12),
});

/**
 * Page slug. Delegates to the pipeline's own slugger so a title with no ASCII
 * (every Korean or Chinese pSEO title, now that the set is generated in the
 * blog's language) falls back to a unique `post-{id}` instead of an empty
 * string — which collided on `posts (domain_id, slug)` and failed the insert
 * for every page after the first.
 */
function slugify(title: string, keyword: string) {
  return postSlug(title, randomUUID().replace(/-/g, ''), keyword);
}

// Generate the previewed set: one lean page per spec, each routed to review.
// Pages are generated sequentially to stay polite to the model API; the whole
// batch runs inside the function's maxDuration.
export async function POST(req: Request) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Cost-bearing: each request fans out to a full page-gen pipeline + Replicate
  // cover per spec (up to 12). Gate it like the article pipeline.
  const limited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
  if (limited) return limited;

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  const blocked = await enforceEntitlement(user.id, 'pseo_generate', sb);
  if (blocked) return blocked;

  const parsed = body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  const { data: domain } = await sb
    .from('domains').select('id, site_profile, language').eq('id', parsed.data.domain_id).single();
  if (!domain) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const profile = (domain as any).site_profile as SiteProfile | null;
  const lang = languageForDomain(domain).code;
  if (!profile?.business?.name) {
    return NextResponse.json({ error: 'no_profile' }, { status: 409 });
  }

  // Reserve the whole batch up front. pSEO is the highest-volume generation
  // path in the app, so letting it through unmetered would undo the quota
  // everywhere else. Unused reservations are handed back below.
  const want = parsed.data.pages.length;
  const reserved = await consumeQuota(user.id, want);
  if (!reserved.ok) {
    const { state } = reserved;
    return NextResponse.json(
      {
        error: 'quota_exhausted',
        message: state.remaining > 0
          ? `That batch needs ${want} posts but only ${state.remaining} remain in this month's plan.`
          : exhaustedMessage(state),
        limit: state.limit,
        used: state.used,
        remaining: state.remaining,
        resets_at: state.resetsAt,
      },
      { status: 402 },
    );
  }

  const admin = supabaseAdmin();
  const created: string[] = [];
  let failed = 0;

  for (const spec of parsed.data.pages as PseoPageSpec[]) {
    try {
      const content = await generateProgrammaticPage(profile, spec, lang);
      const { data, error } = await admin.from('posts').insert({
        domain_id: parsed.data.domain_id,
        status: 'review',
        topic: spec.keyword,
        title: spec.title,
        slug: slugify(spec.title, spec.keyword),
        body_md: content.body_md,
        meta_title: content.meta_title,
        meta_description: content.meta_description,
      }).select('id').single();
      if (error || !data) { failed++; continue; }
      created.push(data.id);
      await admin.from('topic_memory').insert({ domain_id: parsed.data.domain_id, keyword: spec.keyword });
    } catch {
      failed++;
    }
  }

  // Give back whatever the batch didn't actually produce.
  if (failed) await releaseQuota(user.id, failed);

  // Cover images run after the response so they don't block the batch.
  if (created.length) {
    after(async () => { for (const id of created) { try { await runCoverForPost(id); } catch {} } });
  }

  return NextResponse.json({ created: created.length, failed, ids: created });
}
