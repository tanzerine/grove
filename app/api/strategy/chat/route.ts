/**
 * Plan chat — POST a message, GET the history + remaining budget.
 *
 * The cost breaker between conversation and the agent loop (see
 * lib/strategy/plan-chat.ts): questions run on the fast model against the
 * ~500-token plan memo; revisions are one strategist call that edits the plan
 * in place. Monthly caps are enforced here by counting persisted rows, so
 * they hold across serverless instances and can't be bypassed client-side.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { contextForPrompt } from '@/lib/strategy/context';
import { getAgentContext, savePlanContext } from '@/lib/strategy/context-store';
import {
  PLAN_CHAT_LIMITS,
  classifyPlanMessage,
  answerPlanQuestion,
  reviseStrategy,
} from '@/lib/strategy/plan-chat';
import type { Strategy } from '@/lib/strategy/build';
import { canGenerateForUser } from '@/lib/billing';
import { loadServiceState } from '@/lib/analytics/dashboard';
import { serviceStateMd } from '@/lib/analytics/service-state';
import { isConfigured as gscConfigured } from '@/lib/search-console/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postBody = z.object({
  domain_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
});

type Budget = { messagesLeft: number; revisionsLeft: number };

async function monthlyBudget(domainId: string): Promise<Budget> {
  const sb = supabaseAdmin();
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const since = monthStart.toISOString();

  const [{ count: msgs }, { count: revs }] = await Promise.all([
    sb.from('plan_chat_messages').select('id', { count: 'exact', head: true })
      .eq('domain_id', domainId).eq('role', 'user').gte('created_at', since),
    sb.from('plan_chat_messages').select('id', { count: 'exact', head: true })
      .eq('domain_id', domainId).eq('role', 'agent').eq('revised', true).gte('created_at', since),
  ]);
  return {
    messagesLeft: Math.max(0, PLAN_CHAT_LIMITS.messagesPerMonth - (msgs ?? 0)),
    revisionsLeft: Math.max(0, PLAN_CHAT_LIMITS.revisionsPerMonth - (revs ?? 0)),
  };
}

async function ownedDomain(domainId: string) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { user: null, domain: null };
  const { data: domain } = await sb
    .from('domains')
    .select('id, hostname, posts_per_week')
    .eq('id', domainId)
    .eq('user_id', user.id)
    .maybeSingle();
  return { user, domain };
}

export async function GET(req: Request) {
  const domainId = new URL(req.url).searchParams.get('domain_id') ?? '';
  if (!z.string().uuid().safeParse(domainId).success) {
    return NextResponse.json({ error: 'invalid domain_id' }, { status: 400 });
  }
  const { user, domain } = await ownedDomain(domainId);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const sb = supabaseAdmin();
  const { data: messages } = await sb
    .from('plan_chat_messages')
    .select('id, role, content, revised, created_at')
    .eq('domain_id', domainId)
    .order('created_at', { ascending: true })
    .limit(50);

  return NextResponse.json({ messages: messages ?? [], budget: await monthlyBudget(domainId) });
}

export async function POST(req: Request) {
  const parsed = postBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  const { domain_id, message } = parsed.data;

  const { user, domain } = await ownedDomain(domain_id);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!domain) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const limited = await enforceRateLimit(`planchat:${user.id}`, LIMITS.llm);
  if (limited) return limited;

  // Cost-bearing generation is a paid feature: no live subscription, no LLM run.
  if (!(await canGenerateForUser(user.id))) {
    return NextResponse.json(
      { error: 'payment_required', message: 'An active subscription is required to generate content.' },
      { status: 402 },
    );
  }

  const budget = await monthlyBudget(domain_id);
  if (budget.messagesLeft <= 0) {
    return NextResponse.json({
      reply: 'The plan chat has hit this month\'s message limit. It resets on the 1st — the monthly re-plan will also fold in everything we\'ve discussed.',
      kind: 'capped', revised: false, budget,
    });
  }

  const admin = supabaseAdmin();
  const { data: strategyRow } = await admin
    .from('strategies').select('*')
    .eq('domain_id', domain_id).eq('active', true)
    .order('month', { ascending: false }).limit(1).maybeSingle();
  if (!strategyRow) {
    return NextResponse.json({ error: 'no active plan — build one first' }, { status: 409 });
  }

  await admin.from('plan_chat_messages').insert({
    domain_id, strategy_id: strategyRow.id, role: 'user', content: message,
  });
  budget.messagesLeft -= 1;

  const strategy: Strategy = {
    month: String(strategyRow.month).slice(0, 7),
    source: strategyRow.source,
    goals: strategyRow.goals ?? [],
    kpis: strategyRow.kpis ?? [],
    pillars: strategyRow.pillars ?? [],
    publishing_plan: strategyRow.publishing_plan ?? [],
    direction: strategyRow.direction ?? undefined,
    notes: strategyRow.notes ?? '',
  };

  const kind = classifyPlanMessage(message);
  let reply: string;
  let revised = false;

  try {
    if (kind === 'revision' && budget.revisionsLeft <= 0) {
      reply = `This month's plan-revision budget is used up (${PLAN_CHAT_LIMITS.revisionsPerMonth} revisions). I can still answer questions about the plan, and the monthly re-plan on the 1st takes your notes into account.`;
    } else if (kind === 'revision') {
      // Slots with a post already drafted or live must survive the revision.
      const { data: linkedPosts } = await admin
        .from('posts').select('slot_id, status')
        .eq('strategy_id', strategyRow.id).not('slot_id', 'is', null);
      const lockedSlotIds = (linkedPosts ?? [])
        .filter((p: any) => p.status !== 'failed')
        .map((p: any) => p.slot_id as string);

      const outcome = await reviseStrategy({
        current: strategy,
        instruction: message,
        hostname: domain.hostname,
        postsPerWeek: (domain as any).posts_per_week ?? 4,
        lockedSlotIds,
      });

      // Swap the active strategy row: deactivate old, insert revised.
      await admin.from('strategies').update({ active: false })
        .eq('domain_id', domain_id).eq('active', true);
      const { data: inserted } = await admin.from('strategies').insert({
        domain_id,
        month: strategyRow.month,
        source: 'revised',
        goals: outcome.strategy.goals,
        kpis: outcome.strategy.kpis,
        pillars: outcome.strategy.pillars,
        publishing_plan: outcome.strategy.publishing_plan,
        direction: outcome.strategy.direction ?? null,
        interview: strategyRow.interview ?? null,
        prev_review: strategyRow.prev_review ?? null,
        notes: outcome.strategy.notes,
        active: true,
      }).select('id').single();

      // Re-link existing posts to the new row so the scheduler doesn't
      // re-materialize slots that already have a post.
      if (inserted?.id) {
        await admin.from('posts').update({ strategy_id: inserted.id })
          .eq('strategy_id', strategyRow.id);
      }

      await savePlanContext(domain_id, outcome.strategy, domain.hostname);
      reply = outcome.reply;
      revised = true;
      budget.revisionsLeft -= 1;
    } else {
      const ctx = await getAgentContext(domain_id);
      // Ground answers in live operational state (pipeline, syncs, tracking,
      // quality) so "how are we doing?" reflects what's actually running, not
      // just the plan memo. Fail-soft: on any error the block is simply absent.
      let stateMd = '';
      try {
        const { data: domRow } = await admin.from('domains').select('*').eq('id', domain_id).maybeSingle();
        stateMd = serviceStateMd(await loadServiceState(admin, (domRow ?? { id: domain_id }) as any, gscConfigured()));
      } catch { /* fail-soft — the block is simply absent */ }
      reply = await answerPlanQuestion({
        message,
        contextMd: [stateMd, contextForPrompt(ctx.plan_md, ctx.progress_md)].filter(Boolean).join('\n\n'),
        hostname: domain.hostname,
      });
    }
  } catch (err: any) {
    console.error('[plan-chat]', err);
    reply = 'I hit a snag processing that — the plan is unchanged. Try again in a moment.';
  }

  await admin.from('plan_chat_messages').insert({
    domain_id, strategy_id: strategyRow.id, role: 'agent', content: reply, revised,
  });

  return NextResponse.json({ reply, kind, revised, budget });
}
