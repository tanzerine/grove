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
import { generatePost } from '@/lib/pipeline/generate';
import { runCoverForPost } from '@/lib/pipeline/cover-image';
import { getAgentContext } from '@/lib/strategy/context-store';
import { contextForPrompt } from '@/lib/strategy/context';
import { classifyIntent, parseSlash, writeTopicFrom, type AssistantIntent } from '@/lib/assistant/triage';
import { answerAssistant } from '@/lib/assistant/chat';
import { PLAN_CHAT_LIMITS } from '@/lib/strategy/plan-chat';
import { planChatBudget, applyPlanRevision } from '@/lib/strategy/apply-revision';
import { gatherSignals, signalsBlock } from '@/lib/assistant/context';
import { relevantKnowledge } from '@/lib/assistant/knowledge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // the queued article pipeline finishes in after()

const postBody = z.object({
  domain_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
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
}) => NextResponse.json({ changes: [], links: [], ...body });

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
  const { domain_id, message, history = [] } = parsed.data;

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

    const { data: post, error } = await sb.from('posts').insert({
      domain_id, status: 'queued', topic,
    }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Run the pipeline after the response — the chat stays snappy while the
    // draft works through research → write → quality gate.
    after(async () => {
      try {
        await generatePost(post.id);
        await runCoverForPost(post.id);
      } catch (e: any) {
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
    const { thought, reply } = await answerAssistant({
      hostname: domain.hostname,
      intent,
      message: question,
      signalsMd: signalsBlock(signals),
      planMd: contextForPrompt(agentCtx.plan_md, agentCtx.progress_md, 3000),
      history,
    });
    return ok({ intent, thought, reply, links: linksFor(intent, message) });
  } catch (err) {
    console.error('[assistant-chat]', err);
    return ok({
      intent, thought: '',
      reply: 'I hit a snag answering that — nothing was changed. Try again in a moment.',
    });
  }
}
