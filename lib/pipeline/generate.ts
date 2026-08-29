/**
 * 5-step pipeline. Each step writes start/done/fail to posts.generation_log
 * so the UI can render a live timeline (no Vercel-logs dig required).
 */
import { supabaseAdmin } from '../supabase/admin';
import { runWriter } from './writer';
import { validatePost, blockingIssues } from './validator';
import { profileSite, captureSiteDesign, type SiteProfile } from './site-profile';
import { gatherContext } from './research-context';
import { refineTopic } from './topic-refiner';
import { repoKbPrompt, type RepoKnowledge } from './repo-knowledge';
import { appendLog, resetLog } from './log';
import { runMetered, summarize, describeCost } from '../cost-meter';
import { evaluateDraft, composeRewriteInstructions, holdForReview, resolvePublishFloor } from './manager';
import { toManagerDraft } from './draft-adapter';
import { postSlug } from '../slug';
import { languageForDomain, contentLength } from '../language';
import { captureServer } from '../analytics/capture-server';
import { nextPublishSlot } from '../strategy/schedule';
import type { Strategy, PostSlot } from '../strategy/build';

export type ResumeState = { reuseResearch: boolean; reuseDraft: boolean };

/**
 * What a (re)generation can safely skip because a prior run already persisted
 * it. Research is reusable once the brief AND the full context are stored; a
 * draft is reusable only when research is (the manager + validator need the
 * context). This is what lets a retry fire from the stage that actually failed
 * instead of re-drafting, re-managing, and re-imaging work that succeeded.
 *
 * `fresh` is the other intent entirely: the reader asked for a NEW article, so
 * nothing is reused even though a finished draft is sitting right there.
 * Without it a "rewrite from scratch" on a completed post reuses the draft,
 * re-scores it, and persists the same words back — which reads as the button
 * doing nothing at all.
 */
export function resumeState(
  post: { research?: any; body_md?: string | null },
  fresh = false,
): ResumeState {
  if (fresh) return { reuseResearch: false, reuseDraft: false };
  const research = post?.research;
  const reuseResearch = !!(research && research.brief && research.context);
  const draft = (post?.body_md ?? '').trim();
  const reuseDraft = reuseResearch && draft.length > 200;
  return { reuseResearch, reuseDraft };
}

export type GenerateOptions = {
  /** Rewrite from scratch — ignore any persisted research/draft. */
  fresh?: boolean;
  /**
   * The post is live. Every public surface filters on `status = 'published'`,
   * so demoting the row while a full pipeline runs would 404 the article (and
   * poison the CDN) for minutes. With this set the row keeps its published
   * status and its slug all the way through, and the new words swap in at the
   * end.
   */
  keepLive?: boolean;
};

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

async function failAt(postId: string, step: any, err: any, keepLive = false) {
  const msg = String(err?.message ?? err);
  await appendLog(postId, step, 'fail', msg);
  const sb = supabaseAdmin();
  // A live article stays live: a failed rewrite must not strand it in 'failed',
  // which would pull it off the blog. The error is still recorded.
  await sb.from('posts').update({
    ...(keepLive ? {} : { status: 'failed' }),
    validation: { error: msg, failed_at: step },
  }).eq('id', postId);
  throw err;
}

/**
 * Generate one post, metering what it spends.
 *
 * The meter is opened here and read at the end rather than threaded through
 * each step: every LLM call inside this scope reports itself (see
 * lib/cost-meter), so site-profile, topic-refiner, writer, manager and the
 * image prompter stay free of any billing concern.
 */
export async function generatePost(postId: string, opts: GenerateOptions = {}) {
  // Analytics wraps the OUTER function, not the inner one, so every caller is
  // covered by construction: the dashboard's POST /api/posts, the cron drain
  // that produces most of the platform's volume, and retries. Instrumenting
  // the route instead would have measured only the hand-triggered minority.
  const startedAt = Date.now();
  try {
    const { calls } = await runMetered(() => generatePostInner(postId, opts));
    const cost = summarize(calls);
    // Best-effort: a post is not worth failing over its own accounting.
    if (cost.calls > 0) {
      try {
        await appendLog(postId, 'persist', 'done', `cost · ${describeCost(cost)}`, {
          model: Object.keys(cost.byModel).join(', ') || 'unknown',
          costUsd: cost.unpriced === cost.calls ? null : cost.totalUsd,
        });
      } catch { /* accounting must never break the pipeline */ }
    }
    await reportGeneration(postId, startedAt, null);
  } catch (e) {
    await reportGeneration(postId, startedAt, e);
    throw e; // the pipeline's own error contract is unchanged
  }
}

/**
 * Send the generation outcome to PostHog.
 *
 * Reads the row back rather than threading ids down through the pipeline: the
 * owner id and the manager's verdict are both already persisted by the time we
 * get here, and one small select is nothing beside a ~138s generation. It also
 * keeps generatePostInner — which is the part that does the real work —
 * completely free of analytics concerns.
 *
 * Wrapped in its own try/catch on top of captureServer's: captureServer can't
 * throw, but this Supabase read can, and a metrics lookup must never be the
 * reason a finished article is reported as failed.
 */
async function reportGeneration(postId: string, startedAt: number, err: unknown): Promise<void> {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('posts')
      .select('domain_id, validation, domains(user_id)')
      .eq('id', postId)
      .maybeSingle();
    if (!data) return;

    const userId = (data as any).domains?.user_id as string | undefined;
    if (!userId) return;
    const domainId = ((data as any).domain_id as string) ?? '';
    const duration_ms = Date.now() - startedAt;
    const validation = (data as any).validation ?? {};

    if (err) {
      await captureServer(userId, 'post_generation_failed', {
        post_id: postId,
        domain_id: domainId,
        // failAt records which of the five steps threw; anything else failed
        // outside a step boundary and is genuinely unknown.
        step: String(validation.failed_at ?? 'unknown'),
        duration_ms,
      });
      return;
    }

    const manager = validation.manager ?? {};
    await captureServer(userId, 'post_generation_succeeded', {
      post_id: postId,
      domain_id: domainId,
      duration_ms,
      manager_score: typeof manager.overall === 'number' ? manager.overall : null,
      manager_action: manager.action ?? null,
    });
  } catch { /* analytics is observational — never let it alter the outcome */ }
}

async function generatePostInner(postId: string, opts: GenerateOptions = {}) {
  const { fresh = false, keepLive = false } = opts;
  const sb = supabaseAdmin();
  await resetLog(postId);
  await appendLog(postId, 'queued', 'done');

  const { data: post } = await sb.from('posts').select('*, domains(*)').eq('id', postId).single();
  if (!post) throw new Error('post not found');
  const domain = (post as any).domains;
  const topic: string = post.topic ?? domain.hostname;
  // The domain's publication language drives every downstream stage: the
  // brief's title, the article body, what the post-processor splices in, and
  // how the validator measures length. Rows written before migration 0035 have
  // no column at all, which languageForDomain reads as English.
  const lang = languageForDomain(domain);

  // If this post was materialized from a strategy slot, recover the slot's
  // validated target keyword so research + the refiner can aim the article at
  // real search demand. Ad-hoc posts (no slot) simply skip this.
  const targetKeyword = await slotTargetKeyword((post as any).strategy_id, (post as any).slot_id);

  // Product knowledge extracted from the customer's connected GitHub repo
  // (nullable — most domains have none). Gives the refiner the tutorial /
  // deep-dive formats and the writer real features + real steps to cite.
  const repoKb: RepoKnowledge | null = (domain.repo_knowledge as RepoKnowledge | null) ?? null;
  const kb = repoKbPrompt(repoKb);

  // If a prior run already persisted research and/or a draft, resume from the
  // stage that actually failed instead of redoing expensive work.
  const { reuseResearch, reuseDraft } = resumeState(post as any, fresh);

  /** In-flight progress status ('researching'/'writing'), skipped for a live
   *  rewrite so the article keeps serving while it's being rewritten. */
  const setWorking = async (status: 'researching' | 'writing') => {
    if (keepLive) return;
    await sb.from('posts').update({ status }).eq('id', postId);
  };

  // 1. SITE PROFILE (lazy)
  let profile: SiteProfile = domain.site_profile;
  if (!profile?.business?.name) {
    await setWorking('researching');
    await appendLog(postId, 'site_profile', 'start', `crawling ${domain.hostname}`);
    try {
      profile = await profileSite(domain.hostname);
      await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
      await appendLog(postId, 'site_profile', 'done', profile.business.name);
    } catch (e) { await failAt(postId, 'site_profile', e, keepLive); return; }
  } else if (!profile.design) {
    // Backfill the design capture for a profile built before it existed.
    // The condition above only fires when there is NO profile, so without this
    // every domain that predates the feature would keep a null design forever
    // and its hosted blog would keep rendering in grove's colors. One homepage
    // fetch, no LLM — and best-effort: a blog post must never fail over the
    // way its own page is painted.
    //
    // This is the OPPORTUNISTIC half. It only fires when a domain generates,
    // which for a blog that publishes rarely can be never — /api/cron/domains
    // is the half that guarantees every domain gets captured and refreshed.
    try {
      const design = await captureSiteDesign(domain.hostname);
      if (design) {
        profile = { ...profile, design, design_captured_at: new Date().toISOString() };
        await sb.from('domains').update({ site_profile: profile }).eq('id', domain.id);
      }
    } catch { /* keep grove's look for now; next run tries again */ }
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
    await setWorking('researching');
    await appendLog(postId, 'research', 'start',
      `Tavily for "${topic}"${targetKeyword ? ` + keyword "${targetKeyword}"` : ''}`);
    try {
      context = await withRetry(() => gatherContext(topic, profile, targetKeyword, lang.code), 'research');
      await appendLog(postId, 'research', 'done',
        `${context.primary.length} primary, ${context.competitor.length} competitor, ${context.pain.length} pain` +
        `${context.serp.subtopics.length ? `, ${context.serp.subtopics.length} SERP subtopics` : ''}`);
    } catch (e) { await failAt(postId, 'research', e, keepLive); return; }

    await appendLog(postId, 'topic_refiner', 'start', 'picking angle + title');
    try {
      brief = await withRetry(
        () => refineTopic(topic, profile, context, targetKeyword, repoKb, lang.code), 'topic_refiner');
      await appendLog(postId, 'topic_refiner', 'done', `${brief.format}: ${brief.title}`);
    } catch (e) { await failAt(postId, 'topic_refiner', e, keepLive); return; }

    await setWorking('writing');
    await sb.from('posts').update({
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
      `${contentLength(writer.blog_post, lang)} ${lang.length.unitLabel} (reused draft)`);
  } else {
    await appendLog(postId, 'writer', 'start', `drafting ${brief.format}`);
    try {
      writer = await withRetry(
        () => runWriter({ brief, profile, context, kb, hostname: domain.hostname, lang: lang.code }), 'writer');
      await appendLog(postId, 'writer', 'done',
        `${contentLength(writer.blog_post, lang)} ${lang.length.unitLabel}`);
    } catch (e) { await failAt(postId, 'writer', e, keepLive); return; }

    if (!writer.blog_post || writer.blog_post.length < 200) {
      await failAt(postId, 'writer', new Error(`writer returned ${writer.blog_post.length} chars`), keepLive);
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
    // withRetry like every other model call — a transient provider blip (E004
    // "temporarily unavailable") shouldn't leave a good draft ungraded.
    evaluation = await withRetry(() => evaluateDraft({
      attempt: 1, brief, strategy, slot, draft: toManagerDraft(writer), lang: lang.code,
    }), 'manager');
    await persistEvaluation(postId, strategy?.id ?? null, 1, evaluation);
    await appendLog(postId, 'manager', 'done',
      `${evaluation.action} · overall ${evaluation.scores.overall}`);

    if (!reuseDraft && evaluation.action === 'rewrite') {
      await appendLog(postId, 'writer', 'start', `rewrite — applying manager notes`);
      writer = await runWriter({
        brief, profile, context, kb, hostname: domain.hostname, lang: lang.code,
        managerNotes: composeRewriteInstructions(evaluation),
        previousDraft: writer.blog_post,
      });
      await appendLog(postId, 'writer', 'done',
        `${contentLength(writer.blog_post, lang)} ${lang.length.unitLabel} (rewrite)`);
      // Persist the rewritten draft too, for the same resume reason.
      await sb.from('posts').update({
        body_md: writer.blog_post,
        meta_title: writer.meta_title,
        meta_description: writer.meta_description,
      }).eq('id', postId);

      evaluation = await withRetry(() => evaluateDraft({
        attempt: 2, brief, strategy, slot, draft: toManagerDraft(writer), lang: lang.code,
      }), 'manager');
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
    lang: lang.code,
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
  // CJK/emoji-only titles produce no ASCII — fall back to the writer's ASCII
  // slug hint (asked for in CJK languages, so the URL still carries keywords)
  // and then to post-{id8}, so the article never publishes at the blog-home
  // URL with an empty slug.
  const slug = postSlug(title, postId, writer.slug_hint);

  // Autopilot ships unless something is actually WRONG (see holdForReview) —
  // fatal signals only, not "could be better." The score bar is per-domain
  // (owner-adjustable slider), defaulting to AUTO_PUBLISH_FLOOR.
  const fatalConcern = holdForReview(
    evaluation,
    blockingIssues(validation).length,
    resolvePublishFloor((domain as any).auto_publish_floor),
  );

  // Preserve a planned date if one was carried through from the strategy slot;
  // otherwise fall back to the rolling auto-publish cadence.
  const plannedAt: string | null = (post as any).scheduled_at ?? null;
  const canAutoPublish = domain.auto_publish && !fatalConcern;
  const nextStatus: 'review' | 'scheduled' = canAutoPublish ? 'scheduled' : 'review';
  const scheduled_at = plannedAt ?? (canAutoPublish ? nextPublishSlot(domain.posts_per_week) : null);

  // Rewriting a live article swaps the words in place: it stays published, at
  // the same URL. A new title would otherwise mint a new slug and move a page
  // that already has links and search equity pointed at it.
  const liveSlug = (post as any).slug as string | null;

  try {
    await sb.from('posts').update({
      status: keepLive ? 'published' : nextStatus,
      title, slug: keepLive && liveSlug ? liveSlug : slug,
      body_md: writer.blog_post,
      meta_title: writer.meta_title,
      meta_description: writer.meta_description,
      social: null,
      validation,
      scheduled_at: keepLive ? plannedAt : scheduled_at,
    }).eq('id', postId);
    await sb.from('topic_memory').insert({ domain_id: domain.id, keyword: topic });
    await appendLog(postId, 'persist', 'done',
      `→ ${keepLive ? 'published (rewritten in place)' : nextStatus}` +
      `${!keepLive && fatalConcern ? ' (gated — needs your review)' : ''} · ` +
      (validation.passed ? 'validator clean' : `${validation.issues.length} validator flags`));
  } catch (e) { await failAt(postId, 'persist', e, keepLive); return; }

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
