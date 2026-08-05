/**
 * Dashboard assistant chat — the multipurpose agent in the right sidebar.
 *
 * Stateless by design (history rides along from the client, capped), so no
 * new tables are needed. Deterministic triage in lib/assistant/chat.ts keeps
 * cost flat: a "write" request runs zero chat LLM calls (the article pipeline
 * is the work), everything else is one workhorse-model call over a compact
 * signals block. Without a live subscription, setup questions still get the
 * knowledge-base answer for free; LLM paths are gated like every other
 * cost-bearing endpoint.
 */
import { NextResponse, after } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { canGenerateForUser } from '@/lib/billing';
import { enforceNotPaused } from '@/lib/kill-switch';
import { consumeQuota, releaseQuota, exhaustedMessage } from '@/lib/quota';
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { getAgentContext } from '@/lib/strategy/context-store';
import { contextForPrompt } from '@/lib/strategy/context';
import { classifyIntent, parseSlash, writeTopicFrom, isAffirmation, type AssistantIntent } from '@/lib/assistant/triage';
import { answerAssistant } from '@/lib/assistant/chat';
import { PLAN_CHAT_LIMITS } from '@/lib/strategy/plan-chat';
import { planChatBudget, applyPlanRevision } from '@/lib/strategy/apply-revision';
import { latestSnapshot } from '@/lib/search-console/sync';
import { articleRows, type ArticleInfo, type MetricRow } from '@/lib/search-console/insights';
import { pickTitleCandidates, rewriteTitles, TITLE_LIMITS, type TitleRewrite } from '@/lib/assistant/titles';
import { resolvePost, extractReschedule, type PostRef } from '@/lib/assistant/pipeline';
import { approveAndPublish } from '@/lib/pipeline/approve';
import { gatherSignals, signalsBlock } from '@/lib/assistant/context';
import { relevantKnowledge } from '@/lib/assistant/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // the queued article pipeline finishes in after()

const postBody = z.object({
  domain_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
  /** The last proposed_command the panel is holding — executed only when the
   *  message is a bare affirmation ("yes", "do it"), via normal triage. */
  command: z.string().trim().min(1).max(500).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'agent']),
    content: z.string().max(4000),
  })).max(12).optional(),
});

type Change = { label: string; detail: string; href: string };

const ok = (body: {
  intent: AssistantIntent;
  thought: string;
  reply: string;
  changes?: Change[];
  links?: Array<{ label: string; href: string }>;
  /** revert payload for actions the panel can undo (title rewrites) */
  undo?: TitleRewrite[];
  /** actionable phrase the panel renders as a one-tap "Do it" button */
  proposal?: string;
}) => NextResponse.json({ changes: [], links: [], ...body });

/** Intents that write something — a proposal only ships if it triages here,
 *  so the button (or a "yes") is guaranteed to reach an action path. */
const ACTION_INTENTS: AssistantIntent[] = ['write', 'revise', 'titles', 'approve', 'retry', 'reschedule'];

async function loadPosts(domainId: string, statuses: string[]): Promise<PostRef[]> {
  const { data } = await supabaseAdmin()
    .from('posts').select('id, title, topic, status, scheduled_at')
    .eq('domain_id', domainId).in('status', statuses)
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  return (data ?? []).map((p: any) => ({
    id: p.id, title: p.title || p.topic || 'Untitled draft',
    status: p.status, scheduled_at: p.scheduled_at,
  }));
}

/** The "which one?" reply when a reference matches several posts. */
function ambiguous(intent: AssistantIntent, verb: string, posts: PostRef[]) {
  const list = posts.slice(0, 6).map((p) => `• ${p.title}`).join('\n');
  return ok({
    intent, thought: `${posts.length} posts match — need one.`,
    reply: `A few posts fit that — which should I ${verb}?\n${list}\n\nName the one (a word from its title is enough).`,
  });
}

/** Related-page chips for answer intents — small nav help, not "changes". */
function linksFor(intent: AssistantIntent, message: string) {
  const fromGuides = relevantKnowledge(message).map((s) => ({ label: s.title, href: s.href }));
  if (fromGuides.length) return fromGuides;
  if (intent === 'analytics') return [{ label: 'Analytics', href: '/dashboard/analytics' }];
  if (intent === 'strategy') return [{ label: 'Strategy', href: '/dashboard/strategy' }];
  return [];
}

export async function POST(req: Request) {
  const parsed = postBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { domain_id, history = [] } = parsed.data;

  // A bare "yes" with a pending proposal executes the proposal: the command
  // text replaces the message and flows through the same deterministic triage
  // as if the owner had typed it. Anything beyond a plain affirmation ("yes
  // but drop the listicle") stays a normal message.
  const message = parsed.data.command && isAffirmation(parsed.data.message)
    ? parsed.data.command
    : parsed.data.message;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS scopes this select to the owner — a foreign domain_id reads as absent.
  const { data: domain } = await sb
    .from('domains').select('id, hostname, posts_per_week')
    .eq('id', domain_id).eq('user_id', user.id).maybeSingle();
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const limited = await enforceRateLimit(`assist:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  const intent = classifyIntent(message);
  // Platform-wide halt. Above the entitlement read because a paused platform
  // is not a per-account verdict — nobody generates, entitled or not.
  const halted = await enforceNotPaused();
  if (halted) return halted;

  const entitled = await canGenerateForUser(user.id, sb);

  /* ── write: queue the article pipeline, reply instantly ─────────────── */
  if (intent === 'write') {
    if (!entitled) {
      return ok({
        intent, thought: 'Generation is a paid feature.',
        reply: 'Queuing new articles needs an active subscription — once you subscribe I research, draft, quality-check and publish it on autopilot.',
        links: [{ label: 'Billing', href: '/dashboard/billing' }],
      });
    }
    const genLimited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
    if (genLimited) return genLimited;

    const topic = writeTopicFrom(message);
    if (!topic) {
      return ok({
        intent, thought: 'No topic in the request yet.',
        reply: 'Happy to — what should the article be about? Say it like "write an article about spring onboarding tips" and I\'ll queue it straight into the pipeline.',
      });
    }

    const reserved = await consumeQuota(user.id);
    if (!reserved.ok) {
      return ok({
        intent, thought: 'Monthly post quota is used up.',
        reply: exhaustedMessage(reserved.state),
        links: [{ label: 'Billing', href: '/dashboard/billing' }],
      });
    }

    const { data: post, error } = await sb.from('posts').insert({
      domain_id, status: 'queued', topic,
    }).select('id').single();
    if (error) {
      await releaseQuota(user.id);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Run the pipeline after the response — the chat stays snappy while the
    // draft works through research → write → quality gate.
    after(async () => {
      try {
        await generatePost(post.id);
        await runCoverForPost(post.id);
      } catch (e: any) {
        await releaseQuota(user.id);
        await supabaseAdmin().from('posts').update({
          status: 'failed', validation: { error: String(e?.message ?? e) },
        }).eq('id', post.id);
      }
    });

    return ok({
      intent,
      thought: `Queued "${topic}" into the pipeline.`,
      reply: `On it — I've queued an article on "${topic}". It's going through research, drafting and the quality gate now; you can watch it live in the pipeline.`,
      changes: [{ label: 'Pipeline', detail: '1 queued', href: '/dashboard/pipeline' }],
    });
  }

  /* ── titles: rewrite low-CTR titles Google shows but nobody clicks ───── */
  if (intent === 'titles') {
    if (!entitled) {
      return ok({
        intent, thought: 'Title rewrites are a paid feature.',
        reply: 'Rewriting titles needs an active subscription — then I find the articles Google shows but nobody clicks and repackage them.',
        links: [{ label: 'Billing', href: '/dashboard/billing' }],
      });
    }

    const admin = supabaseAdmin();
    const { data: domainRow } = await admin
      .from('domains').select('gsc_site_url').eq('id', domain_id).maybeSingle();
    if (!domainRow?.gsc_site_url) {
      return ok({
        intent, thought: 'No Search Console data to find low-CTR titles.',
        reply: 'I need Google Search Console for this — it tells me which articles get impressions but no clicks. Connect it on the Analytics page and ask me again once a sync has run.',
        links: [{ label: 'Connecting Google Search Console', href: '/dashboard/analytics' }],
      });
    }

    try {
      const [snap, { data: posts }] = await Promise.all([
        latestSnapshot(domain_id),
        admin.from('posts').select('id, title, slug, reads')
          .eq('domain_id', domain_id).eq('status', 'published'),
      ]);
      const pages: MetricRow[] = snap.pages.map((r: any) => ({
        key: r.key, clicks: r.clicks, impressions: r.impressions,
        position: r.position, post_id: r.post_id ?? null,
      }));
      const rows = articleRows(pages, (posts ?? []) as ArticleInfo[]);
      const candidates = pickTitleCandidates(rows);
      if (!candidates.length) {
        return ok({
          intent, thought: 'No title is underperforming enough to touch.',
          reply: `Good news: no article clears my rewrite bar right now (${TITLE_LIMITS.minImpressions}+ impressions with CTR under ${TITLE_LIMITS.maxCtr * 100}%). As impressions grow I'll have more signal — ask me again in a week or two.`,
          links: [{ label: 'Analytics', href: '/dashboard/analytics' }],
        });
      }

      const rewrites = await rewriteTitles({ hostname: domain.hostname, candidates });
      if (!rewrites.length) {
        return ok({
          intent, thought: 'The rewrites did not beat the originals.',
          reply: 'I looked at the low-CTR candidates but couldn\'t produce titles I\'m confident beat the originals — nothing was changed.',
        });
      }

      for (const r of rewrites) {
        await admin.from('posts').update({ title: r.to })
          .eq('id', r.post_id).eq('domain_id', domain_id);
      }

      const lines = rewrites.map((r) => `• "${r.from}" → "${r.to}"`).join('\n');
      return ok({
        intent,
        thought: `Impressions are there, clicks aren't — repackaged ${rewrites.length} title${rewrites.length === 1 ? '' : 's'}.`,
        reply: `These articles rank but don't get picked, so I rewrote their titles:\n${lines}\n\nRankings keep their URLs and content — only the packaging changed. Use Undo if you prefer the originals.`,
        changes: [{ label: 'Titles', detail: `${rewrites.length} rewritten`, href: '/dashboard/published' }],
        undo: rewrites,
      });
    } catch (err) {
      console.error('[assistant-chat] titles', err);
      return ok({
        intent, thought: '',
        reply: 'I hit a snag rewriting titles — nothing was changed. Try again in a moment.',
      });
    }
  }

  /* ── approve: publish a draft that's waiting in review ──────────────── */
  if (intent === 'approve') {
    const instruction = parseSlash(message)?.rest || message;
    const candidates = await loadPosts(domain_id, ['review']);
    const r = resolvePost(instruction, candidates);
    if (r.kind === 'none') {
      return ok({ intent, thought: 'Nothing is waiting for review.', reply: 'There are no drafts waiting for your review right now — nothing to approve.', links: [{ label: 'Pipeline', href: '/dashboard/pipeline' }] });
    }
    if (r.kind === 'many') return ambiguous(intent, 'approve', r.posts);

    const result = await approveAndPublish(sb, r.post.id);
    if (!result.ok) return ok({ intent, thought: '', reply: 'I couldn\'t publish that one — it\'s unchanged. Try again in a moment.' });
    const shared = result.social_result && Object.keys(result.social_result).length
      ? ' It\'s also being shared to your connected channels.' : '';
    return ok({
      intent, thought: `Approved and published "${r.post.title}".`,
      reply: `Published "${r.post.title}" — it's live on your blog now.${shared}`,
      changes: [{ label: 'Published', detail: 'now live', href: '/dashboard/published' }],
    });
  }

  /* ── retry: re-run generation for a failed post ─────────────────────── */
  if (intent === 'retry') {
    if (!entitled) {
      return ok({ intent, thought: 'Generation is a paid feature.', reply: 'Retrying generation needs an active subscription.', links: [{ label: 'Billing', href: '/dashboard/billing' }] });
    }
    const instruction = parseSlash(message)?.rest || message;
    const candidates = await loadPosts(domain_id, ['failed']);
    const r = resolvePost(instruction, candidates);
    if (r.kind === 'none') {
      return ok({ intent, thought: 'No failed posts to retry.', reply: 'Nothing has failed — there\'s no post to retry right now.', links: [{ label: 'Pipeline', href: '/dashboard/pipeline' }] });
    }
    if (r.kind === 'many') return ambiguous(intent, 'retry', r.posts);

    const genLimited = await enforceRateLimit(`gen:${user.id}`, LIMITS.generate);
    if (genLimited) return genLimited;

    const reserved = await consumeQuota(user.id);
    if (!reserved.ok) {
      return ok({
        intent, thought: 'Monthly post quota is used up.',
        reply: exhaustedMessage(reserved.state),
        links: [{ label: 'Billing', href: '/dashboard/billing' }],
      });
    }

    // RLS-scoped reset; select back so a non-owned id can't trigger generation.
    const { data: reset } = await sb.from('posts')
      .update({ status: 'queued', validation: null })
      .eq('id', r.post.id).select('id');
    if (!reset?.length) {
      await releaseQuota(user.id);
      return ok({ intent, thought: '', reply: 'I couldn\'t reset that post — it\'s unchanged.' });
    }

    after(async () => {
      try {
        await generatePost(r.post.id);
        await runCoverForPost(r.post.id);
      } catch (e: any) {
        await releaseQuota(user.id);
        await supabaseAdmin().from('posts').update({
          status: 'failed', validation: { error: String(e?.message ?? e) },
        }).eq('id', r.post.id);
      }
    });
    return ok({
      intent, thought: `Re-queued "${r.post.title}" for another run.`,
      reply: `On it — I've re-queued "${r.post.title}" and it's going back through research, drafting and the quality gate. Watch it in the pipeline.`,
      changes: [{ label: 'Pipeline', detail: 'retrying', href: '/dashboard/pipeline' }],
    });
  }

  /* ── reschedule: move a scheduled/review post to a new publish date ──── */
  if (intent === 'reschedule') {
    const instruction = parseSlash(message)?.rest || message;
    const { when, selector } = extractReschedule(instruction);
    if (!when) {
      return ok({ intent, thought: 'No date I could parse.', reply: 'When should it go out? Try a specific day — "move it to Monday", "reschedule to tomorrow at 9am", or "in 3 days".' });
    }
    const candidates = await loadPosts(domain_id, ['scheduled', 'review']);
    const r = resolvePost(selector, candidates);
    if (r.kind === 'none') {
      return ok({ intent, thought: 'No scheduled drafts to move.', reply: 'There are no scheduled or in-review posts to reschedule right now.', links: [{ label: 'Calendar', href: '/dashboard/calendar' }] });
    }
    if (r.kind === 'many') return ambiguous(intent, 'reschedule', r.posts);

    const { data: moved } = await sb.from('posts')
      .update({ scheduled_at: when.at, status: 'scheduled' })
      .eq('id', r.post.id).select('id');
    if (!moved?.length) return ok({ intent, thought: '', reply: 'I couldn\'t move that one — it\'s unchanged.' });
    return ok({
      intent, thought: `Moved "${r.post.title}" to ${when.label}.`,
      reply: `Done — "${r.post.title}" is now scheduled to publish ${when.label}.`,
      changes: [{ label: 'Calendar', detail: when.label.slice(0, 10), href: '/dashboard/calendar' }],
    });
  }

  /* ── revise: steer the active monthly plan, same caps as the plan chat ─ */
  if (intent === 'revise') {
    if (!entitled) {
      return ok({
        intent, thought: 'Plan changes are a paid feature.',
        reply: 'Changing the plan needs an active subscription — once you subscribe, tell me the change ("add two more conversion posts") and it applies instantly.',
        links: [{ label: 'Billing', href: '/dashboard/billing' }],
      });
    }

    const admin = supabaseAdmin();
    const { data: strategyRow } = await admin
      .from('strategies').select('*')
      .eq('domain_id', domain_id).eq('active', true)
      .order('month', { ascending: false }).limit(1).maybeSingle();
    if (!strategyRow) {
      return ok({
        intent, thought: 'No active plan to revise.',
        reply: 'There\'s no active monthly plan yet — build one from the Strategy page first, then I can revise it from here.',
        links: [{ label: 'Strategy', href: '/dashboard/strategy' }],
      });
    }

    // Shared budget with the strategy-page chat: both surfaces count the same
    // persisted rows, so the monthly caps can't be doubled by switching UIs.
    const budget = await planChatBudget(domain_id);
    if (budget.messagesLeft <= 0) {
      return ok({
        intent, thought: 'Monthly plan-chat message cap reached.',
        reply: 'The plan chat has hit this month\'s message limit. It resets on the 1st — the monthly re-plan will also fold in everything we\'ve discussed.',
      });
    }
    if (budget.revisionsLeft <= 0) {
      return ok({
        intent, thought: 'Monthly revision budget used up.',
        reply: `This month's plan-revision budget is used up (${PLAN_CHAT_LIMITS.revisionsPerMonth} revisions). I can still answer questions about the plan, and the monthly re-plan on the 1st takes your notes into account.`,
        links: [{ label: 'Strategy', href: '/dashboard/strategy' }],
      });
    }

    const instruction = parseSlash(message)?.rest || message;
    await admin.from('plan_chat_messages').insert({
      domain_id, strategy_id: strategyRow.id, role: 'user', content: instruction,
    });

    try {
      const { reply } = await applyPlanRevision({
        domainId: domain_id,
        hostname: domain.hostname,
        postsPerWeek: (domain as any).posts_per_week ?? 4,
        strategyRow,
        instruction,
      });
      await admin.from('plan_chat_messages').insert({
        domain_id, strategy_id: strategyRow.id, role: 'agent', content: reply, revised: true,
      });
      return ok({
        intent,
        thought: 'Applied the change to the active plan.',
        reply,
        changes: [{ label: 'Strategy', detail: `plan revised · ${budget.revisionsLeft - 1} left this month`, href: '/dashboard/strategy' }],
      });
    } catch (err) {
      console.error('[assistant-chat] revise', err);
      const reply = 'I hit a snag applying that — the plan is unchanged. Try again in a moment.';
      await admin.from('plan_chat_messages').insert({
        domain_id, strategy_id: strategyRow.id, role: 'agent', content: reply, revised: false,
      });
      return ok({ intent, thought: '', reply });
    }
  }

  /* ── everything else: one LLM answer over real signals ──────────────── */
  if (!entitled) {
    // Free path: setup questions still deserve an answer — serve the matching
    // knowledge sections verbatim instead of running a cost-bearing model.
    const guides = relevantKnowledge(message);
    if (guides.length) {
      return ok({
        intent, thought: 'Answered from the setup guide.',
        reply: guides.map((s) => `${s.title}\n${s.body}`).join('\n\n'),
        links: guides.map((s) => ({ label: s.title, href: s.href })),
      });
    }
    return ok({
      intent, thought: 'Chat needs a subscription.',
      reply: 'The assistant needs an active subscription to analyze your data and answer. Setup questions I can always help with — try asking "how do I set up the canonical URL?".',
      links: [{ label: 'Billing', href: '/dashboard/billing' }],
    });
  }

  try {
    const [signals, agentCtx] = await Promise.all([
      gatherSignals(domain.id, domain.hostname),
      getAgentContext(domain.id).catch(() => ({ plan_md: '', progress_md: '' })),
    ]);
    const question = parseSlash(message)?.rest || message;
    const { thought, reply, proposedCommand } = await answerAssistant({
      hostname: domain.hostname,
      intent,
      message: question,
      signalsMd: signalsBlock(signals),
      planMd: contextForPrompt(agentCtx.plan_md, agentCtx.progress_md, 3000),
      history,
    });
    // Only ship a proposal that would actually trigger an action — anything
    // that triages back to an answer intent would loop, so it's dropped.
    const proposal = proposedCommand && ACTION_INTENTS.includes(classifyIntent(proposedCommand))
      ? proposedCommand : undefined;
    return ok({ intent, thought, reply, proposal, links: linksFor(intent, message) });
  } catch (err) {
    console.error('[assistant-chat]', err);
    return ok({
      intent, thought: '',
      reply: 'I hit a snag answering that — nothing was changed. Try again in a moment.',
    });
  }
}
