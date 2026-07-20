/**
 * Dashboard assistant — the answer path of the multipurpose chat agent.
 *
 * Same cost-breaker philosophy as the plan chat (lib/strategy/plan-chat.ts):
 * triage is deterministic (lib/assistant/triage.ts, no LLM), "write" requests
 * never touch a chat model at all (the article pipeline is the work), and
 * everything else is ONE workhorse-model call over a compact signals block
 * plus at most two knowledge sections. Never the strategist tier.
 *
 * Prompt assembly is pure (unit-tested); the route owns auth and data.
 */
import { llmCall, extractJson } from '../llm';
import { relevantKnowledge } from './knowledge';
import type { AssistantIntent } from './triage';

export type AssistantTurn = { role: 'user' | 'agent'; content: string };

export type AssistantAnswer = {
  thought: string;
  reply: string;
  /** Exact imperative phrase for an action the route can execute (the panel
   *  shows it as a one-tap button; a bare "yes" also runs it). */
  proposedCommand?: string;
};

export function buildAnswerPrompt(opts: {
  hostname: string;
  intent: AssistantIntent;
  message: string;
  signalsMd: string;          // compact numbers block from context.ts
  planMd: string;             // strategy memo (may be empty)
  history: AssistantTurn[];   // most recent last, already capped by the route
}): { system: string; user: string } {
  const guides = relevantKnowledge(opts.message)
    .map((s) => `### ${s.title} (${s.href})\n${s.body}`)
    .join('\n\n');

  const system = `You are Grove, the AI marketing agent that runs the blog for ${opts.hostname}.
The owner is chatting with you in the dashboard sidebar. Answer like a sharp
marketing teammate: concrete, plain language, 2-5 short sentences, no jargon,
no filler. Ground every number in the SIGNALS block — never invent metrics.
If a metric isn't in the signals, say it isn't tracked yet and how to get it
(e.g. connect Search Console). When diagnosing traffic ("why is this month
lacking new viewers?"), reason from what's there: publish count, impressions
vs clicks (CTR), organic share, and how young the blog is — then give 1-2
specific next moves. For setup questions, answer strictly from the GUIDES
section and point at the dashboard page.

THIS REPLY IS WORDS ONLY — you cannot change anything from here. Never say
you did, are doing, or will do something. Actions run through separate
commands: queue a new article ("write an article about <topic>"), revise the
monthly plan ("add two more conversion posts"), rewrite low-CTR titles
("rewrite my low-CTR titles"), approve a draft in review, retry a failed
post, reschedule a post ("move the launch post to Friday"). If the owner
seems to want one of these, put the exact imperative phrase in
"proposed_command" — it becomes a button that actually runs it — and in the
reply say what it will do, not that it's done.

SIGNALS for ${opts.hostname}
${opts.signalsMd || '(no data yet)'}
${opts.planMd ? `\nCURRENT PLAN MEMO\n${opts.planMd}` : ''}
${guides ? `\nGUIDES\n${guides}` : ''}

OUTPUT: ONE raw JSON object, no markdown fences:
{"thought":"one short sentence — your reasoning headline","reply":"the answer, plain text","proposed_command":"omit unless the owner wants an action — then the exact imperative phrase"}`;

  const transcript = opts.history
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'OWNER' : 'YOU'}: ${t.content}`)
    .join('\n');

  const user = `${transcript ? `RECENT CONVERSATION\n${transcript}\n\n` : ''}OWNER: ${opts.message}`;
  return { system, user };
}

export async function answerAssistant(opts: {
  hostname: string;
  intent: AssistantIntent;
  message: string;
  signalsMd: string;
  planMd: string;
  history: AssistantTurn[];
}): Promise<AssistantAnswer> {
  const { system, user } = buildAnswerPrompt(opts);
  const { text } = await llmCall({ system, user, maxTokens: 700 });
  try {
    const parsed = extractJson<{ thought?: string; reply?: string; proposed_command?: string }>(text);
    if (parsed.reply) {
      const proposal = (parsed.proposed_command ?? '').trim();
      return {
        thought: (parsed.thought ?? '').trim(),
        reply: parsed.reply.trim(),
        proposedCommand: proposal || undefined,
      };
    }
  } catch { /* fall through — treat raw text as the reply */ }
  return { thought: '', reply: text.trim() };
}
