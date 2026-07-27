/**
 * Plan chat — POST a message, GET the history + remaining budget.
 *
 * The cost breaker between conversation and the agent loop (see
 * lib/strategy/plan-chat.ts): questions run on the fast model against the
 * ~500-token plan memo; revisions are one strategist call that edits the plan
 * in place. Monthly caps are enforced by counting persisted rows (shared with
 * the sidebar assistant via lib/strategy/apply-revision.ts), so they hold
 * across serverless instances and can't be bypassed client-side.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceRateLimit, LIMITS } from '@/lib/ratelimit';
import { contextForPrompt } from '@/lib/strategy/context';
import { getAgentContext } from '@/lib/strategy/context-store';
import {
  PLAN_CHAT_LIMITS,
  classifyPlanMessage,
  answerPlanQuestion,
} from '@/lib/strategy/plan-chat';
import { planChatBudget, applyPlanRevision } from '@/lib/strategy/apply-revision';
import { enforceEntitlement } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const postBody = z.object({
  domain_id: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
});

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

  return NextResponse.json({ messages: messages ?? [], budget: await planChatBudget(domainId) });
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
  const blocked = await enforceEntitlement(user.id, 'strategy_chat');
  if (blocked) return blocked;

  const budget = await planChatBudget(domain_id);
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

  const kind = classifyPlanMessage(message);
  let reply: string;
  let revised = false;

  try {
    if (kind === 'revision' && budget.revisionsLeft <= 0) {
      reply = `This month's plan-revision budget is used up (${PLAN_CHAT_LIMITS.revisionsPerMonth} revisions). I can still answer questions about the plan, and the monthly re-plan on the 1st takes your notes into account.`;
    } else if (kind === 'revision') {
      const outcome = await applyPlanRevision({
        domainId: domain_id,
        hostname: domain.hostname,
        postsPerWeek: (domain as any).posts_per_week ?? 4,
        strategyRow,
        instruction: message,
      });
      reply = outcome.reply;
      revised = true;
      budget.revisionsLeft -= 1;
    } else {
      const ctx = await getAgentContext(domain_id);
      reply = await answerPlanQuestion({
        message,
        contextMd: contextForPrompt(ctx.plan_md, ctx.progress_md),
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
