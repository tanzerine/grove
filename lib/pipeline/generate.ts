/**
 * 5-step pipeline. Each step writes start/done/fail to posts.generation_log
 * so the UI can render a live timeline (no Vercel-logs dig required).
 */
import { supabaseAdmin } from '../supabase/admin';
import { runWriter } from './writer';
import { validatePost, blockingIssues } from './validator';
import { profileSite, type SiteProfile } from './site-profile';
import { gatherContext } from './research-context';
import { refineTopic } from './topic-refiner';
import { appendLog, resetLog } from './log';
import { evaluateDraft, composeRewriteInstructions, QUALITY_FLOOR } from './manager';
import { toManagerDraft } from './draft-adapter';
import { postSlug } from '../slug';
import { nextPublishSlot } from '../strategy/schedule';
import type { Strategy, PostSlot } from '../strategy/build';

export type ResumeState = { reuseResearch: boolean; reuseDraft: boolean };

/**
 * What a (re)generation can safely skip because a prior run already persisted
 * it. Research is reusable once the brief AND the full context are stored; a
 * draft is reusable only when research is (the manager + validator need the
 * context). This is what lets a retry fire from the stage that actually failed
 * instead of re-drafting, re-managing, and re-imaging work that succeeded.
 */
export function resumeState(post: { research?: any; body_md?: string | null }): ResumeState {
  const research = post?.research;
  const reuseResearch = !!(research && research.brief && research.context);
  const draft = (post?.body_md ?? '').trim();
  const reuseDraft = reuseResearch && draft.length > 200;
  return { reuseResearch, reuseDraft };
}

/**
 * Retry a transient pipeline step a couple of times before giving up. LLM
 * calls occasionally time out, return empty, or emit malformed JSON — a single
 * blip shouldn't fail an article the model would produce fine on a retry.
 * Only wraps idempotent stages (research, refiner, writer); the manager is
 * already non-fatal, and DB writes aren't retried here.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        console.warn(`[pipeline] ${label} attempt ${i} failed, retrying:`, (e as any)?.message ?? e);
        await new Promise((r) => setTimeout(r, 1500 * i));
      }
    }
  }
  throw lastErr;
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

  // If this post was materialized from a strategy slot, recover the slot's
  // validated target keyword so research + the refiner can aim the article at
  // real search demand. Ad-hoc posts (no slot) simply skip this.
  const targetKeyword = await slotTargetKeyword((post as any).strategy_id, (post as any).slot_id);

  // If a prior run already persisted research and/or a draft, resume from the
  // stage that actually failed instead of redoing expensive work.
  const { reuseResearch, reuseDraft } = resumeState(post as any);

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

  // 2 + 3. RESEARCH + TOPIC REFINER
  let context!: Awaited<ReturnType<typeof gatherContext>>;
  let brief!: Awaited<ReturnType<typeof refineTopic>>;
  if (reuseResearch) {
    // Reuse the persisted research + full context — nothing here is re-run.
    context = (post as any).research.context;
    brief = (post as any).research.brief;
    await appendLog(postId, 'research', 'done', 'reused prior research');
    await appendLog(postId, 'topic_refiner', 'done', `${brief.format}: ${brief.title} (reused)`);
  } else {
    await sb.from('posts').update({ status: 'researching' }).eq('id', postId);
    await appendLog(postId, 'research', 'start',
      `Tavily for "${topic}"${targetKeyword ? ` + keyword "${targetKeyword}"` : ''}`);
    try {
      context = await withRetry(() => gatherContext(topic, profile, targetKeyword), 'research');
      await appendLog(postId, 'research', 'done',
        `${context.primary.length} primary, ${context.competitor.length} competitor, ${context.pain.length} pain` +
        `${context.serp.subtopics.length ? `, ${context.serp.subtopics.length} SERP subtopics` : ''}`);
    } catch (e) { await failAt(postId, 'research', e); return; }

    await appendLog(postId, 'topic_refiner', 'start', 'picking angle + title');
    try {
      brief = await withRetry(() => refineTopic(topic, profile, context, targetKeyword), 'topic_refiner');
      await appendLog(postId, 'topic_refiner', 'done', `${brief.format}: ${brief.title}`);
    } catch (e) { await failAt(postId, 'topic_refiner', e); return; }

    await sb.from('posts').update({
      status: 'writing',
      research: {
        topic, brief,
        primary: context.primary.map((s) => ({ url: s.url, title: s.title })),
        competitor: context.competitor.map((s) => ({ url: s.url, title: s.title })),
        pain: context.pain.map((s) => ({ url: s.url, title: s.title })),
        serp: context.serp,
        // Full context (with snippets) so a retry can resume at the writer
        // stage without re-searching.
        context,
      },
    }).eq('id', postId);
  }

  // 4. WRITER
  let writer!: Awaited<ReturnType<typeof runWriter>>;
  if (reuseDraft) {
    writer = {
      blog_post: (post as any).body_md as string,
      meta_title: (post as any).meta_title ?? '',
      meta_description: (post as any).meta_description ?? '',
      sources_provided: [],
    };
    await appendLog(postId, 'writer', 'done',
      `${writer.blog_post.split(/\s+/).length} words (reused draft)`);
  } else {
    await appendLog(postId, 'writer', 'start', `drafting ${brief.format}`);
    try {
      writer = await withRetry(
        () => runWriter({ brief, profile, context, hostname: domain.hostname }), 'writer');
      await appendLog(postId, 'writer', 'done', `${writer.blog_post.split(/\s+/).length} words`);
    } catch (e) { await failAt(postId, 'writer', e); return; }

    if (!writer.blog_post || writer.blog_post.length < 200) {
      await failAt(postId, 'writer', new Error(`writer returned ${writer.blog_post.length} chars`));
      return;
    }

    // Persist the draft the moment it exists so a later failure (manager or the
    // final persist) can be retried without paying to re-draft.
    await sb.from('posts').update({
      body_md: writer.blog_post,
      meta_title: writer.meta_title,
      meta_description: writer.meta_description,
    }).eq('id', postId);
  }

  // 4b. MANAGER — gate on strategic fit + craft + marketing intent.
  // A fresh draft loops once on 'rewrite'; a resumed draft is evaluated once
  // and never re-drafted (any non-approve routes it to human review below).
  // Prefer the exact strategy/slot link (set when materialized from the plan);
  // fall back to fuzzy title matching for ad-hoc / legacy posts.
  const { strategy, slot } = await loadActiveStrategy(
    domain.id, brief, { strategyId: (post as any).strategy_id, slotId: (post as any).slot_id },
  );
  let evaluation;
  try {
    await appendLog(postId, 'manager', 'start', reuseDraft ? 'evaluating existing draft' : `attempt 1`);
    evaluation = await evaluateDraft({
      attempt: 1, brief, strategy, slot, draft: toManagerDraft(writer),
    });
    await persistEvaluation(postId, strategy?.id ?? null, 1, evaluation);
    await appendLog(postId, 'manager', 'done',
      `${evaluation.action} · overall ${evaluation.scores.overall}`);

    if (!reuseDraft && evaluation.action === 'rewrite') {
      await appendLog(postId, 'writer', 'start', `rewrite — applying manager notes`);
      writer = await runWriter({
        brief, profile, context, hostname: domain.hostname,
        managerNotes: composeRewriteInstructions(evaluation),
        previousDraft: writer.blog_post,
      });
      await appendLog(postId, 'writer', 'done',
        `${writer.blog_post.split(/\s+/).length} words (rewrite)`);
      // Persist the rewritten draft too, for the same resume reason.
      await sb.from('posts').update({
        body_md: writer.blog_post,
        meta_title: writer.meta_title,
        meta_description: writer.meta_description,
      }).eq('id', postId);

      evaluation = await evaluateDraft({
        attempt: 2, brief, strategy, slot, draft: toManagerDraft(writer),
      });
      await persistEvaluation(postId, strategy?.id ?? null, 2, evaluation);
      await appendLog(postId, 'manager', 'done',
        `final ${evaluation.action} · overall ${evaluation.scores.overall}`);
    }
  } catch (e) {
    // Manager failure should NOT take the article down — log and proceed.
    await appendLog(postId, 'manager', 'fail', String((e as any)?.message ?? e));
    evaluation = null;
  }

  // 5. PERSIST
  // The manager NEVER discards a finished draft. A reject or any serious flag
  // routes the post to human REVIEW (with the manager's concerns attached),
  // not to 'failed'. 'failed' is reserved for real pipeline errors. This keeps
  // the owner in control instead of silently throwing away good work — e.g. a
  // draft scoring 85 should never be deleted just because round 2 couldn't
  // squeeze in one more rewrite.
  const title = writer.meta_title || brief.title || topic.slice(0, 60);
  // Everything the writer was allowed to know — numeric claims in the draft
  // must trace back to this corpus or carry an inline citation (fact grounding).
  const researchText = [...context.primary, ...context.competitor, ...context.pain]
    .map((s) => `${s.title} ${s.snippet}`).join('\n');
  const validation = validatePost(writer.blog_post, {
    title,
    intent: brief.marketing_intent,
    serpSubtopics: context.serp.subtopics,
    researchText,
  });
  if (evaluation) {
    (validation as any).manager = {
      action: evaluation.action,
      overall: evaluation.scores?.overall ?? null,
      reject_reason: evaluation.reject_reason ?? null,
      issues: (evaluation.issues ?? []).filter((i) => i.severity !== 'note').map((i) => `${i.rule}: ${i.note}`),
    };
  }
  // CJK/emoji-only titles produce no ASCII — fall back to post-{id8} so the
  // article never publishes at the blog-home URL with an empty slug.
  const slug = postSlug(title, postId);

  // Route to review (not auto-publish) whenever the gate can't honestly vouch
  // for the draft — even if auto_publish is on:
  //   - the manager crashed (no evaluation = no gate; publishing ungated was
  //     the old behavior and it was wrong)
  //   - any non-approve verdict (reject, or an attempt-2 rewrite that stands)
  //   - block/rewrite-severity issues (incl. evaluation_integrity glitches)
  //   - overall below QUALITY_FLOOR (missing overall counts as 0, not 100)
  //   - a blocking deterministic-validator issue (unsupported/recycled stats,
  //     thin content, missing H1, referral-away)
  const managerConcern =
    !evaluation ||
    evaluation.action !== 'approve' ||
    (evaluation.issues ?? []).some((i) => i.severity === 'block' || i.severity === 'rewrite') ||
    (evaluation.scores?.overall ?? 0) < QUALITY_FLOOR ||
    blockingIssues(validation).length > 0;

  // Preserve a planned date if one was carried through from the strategy slot;
  // otherwise fall back to the rolling auto-publish cadence.
  const plannedAt: string | null = (post as any).scheduled_at ?? null;
  const canAutoPublish = domain.auto_publish && !managerConcern;
  const nextStatus: 'review' | 'scheduled' = canAutoPublish ? 'scheduled' : 'review';
  const scheduled_at = plannedAt ?? (canAutoPublish ? nextPublishSlot(domain.posts_per_week) : null);

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
      `→ ${nextStatus}${managerConcern ? ' (gated — needs your review)' : ''} · ` +
      (validation.passed ? 'validator clean' : `${validation.issues.length} validator flags`));
  } catch (e) { await failAt(postId, 'persist', e); return; }

  // NOTE: cover image is intentionally NOT triggered here.
  // It's scheduled by the API route via Next's after() so it actually runs
  // past the response (fire-and-forget here would die when Vercel terminates
  // the serverless function).
}

/**
 * Load the active strategy for a domain and find the publishing-plan slot
 * this brief belongs to (best-match by title overlap). Both nullable —
 * older posts predate the strategy layer.
 */
async function loadActiveStrategy(
  domainId: string,
  brief: { title: string; format: string },
  link?: { strategyId?: string | null; slotId?: string | null },
): Promise<{ strategy: (Strategy & { id: string }) | null; slot: PostSlot | null }> {
  const sb = supabaseAdmin();

  // Exact link path: the post was materialized from a specific slot.
  if (link?.strategyId) {
    const { data: exact } = await sb
      .from('strategies').select('*').eq('id', link.strategyId).maybeSingle();
    if (exact) {
      const strategy = exact as unknown as Strategy & { id: string };
      const slot = link.slotId
        ? (strategy.publishing_plan ?? []).find((s) => s.id === link.slotId) ?? null
        : null;
      return { strategy, slot };
    }
  }

  const { data } = await sb
    .from('strategies')
    .select('*')
    .eq('domain_id', domainId)
    .eq('active', true)
    .order('month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { strategy: null, slot: null };
  const strategy = data as unknown as Strategy & { id: string };

  // Cheap slot match: highest token overlap between brief title and slot topic.
  const briefTokens = new Set(brief.title.toLowerCase().split(/\W+/).filter(Boolean));
  let best: PostSlot | null = null;
  let bestScore = 0;
  for (const slot of strategy.publishing_plan ?? []) {
    const tokens = new Set(slot.topic.toLowerCase().split(/\W+/).filter(Boolean));
    let overlap = 0;
    for (const t of tokens) if (briefTokens.has(t)) overlap++;
    if (overlap > bestScore) { best = slot; bestScore = overlap; }
  }
  return { strategy, slot: best };
}

/** Recover the target_keyword the strategist assigned to this post's slot.
 *  Returns undefined for ad-hoc posts or when the slot has no keyword. */
async function slotTargetKeyword(
  strategyId?: string | null,
  slotId?: string | null,
): Promise<string | undefined> {
  if (!strategyId || !slotId) return undefined;
  const sb = supabaseAdmin();
  const { data } = await sb
    .from('strategies').select('publishing_plan').eq('id', strategyId).maybeSingle();
  const plan = ((data as any)?.publishing_plan ?? []) as PostSlot[];
  const kw = plan.find((s) => s.id === slotId)?.target_keyword?.trim();
  return kw || undefined;
}

// nextPublishSlot lives in lib/strategy/schedule.ts (pure, unit-tested) — it
// must tolerate legacy posts_per_week values (0/null) without throwing here.

async function persistEvaluation(
  postId: string,
  strategyId: string | null,
  attempt: number,
  ev: Awaited<ReturnType<typeof evaluateDraft>>,
) {
  const sb = supabaseAdmin();
  await sb.from('post_evaluations').insert({
    post_id: postId,
    strategy_id: strategyId,
    attempt,
    action: ev.action,
    pass: ev.pass,
    scores: ev.scores,
    issues: ev.issues,
    rewrite_brief: ev.rewrite_brief ?? null,
  });
}
