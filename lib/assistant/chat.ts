/**
 * Dashboard assistant — the answer path of the multipurpose chat agent.
 *
 * Same cost-breaker philosophy as the plan chat (lib/strategy/plan-chat.ts):
 * triage is deterministic (lib/assistant/triage.ts, no LLM), "write" requests
 * never touch a chat model at all (the article pipeline is the work), and
 * everything else is ONE workhorse-model call over a compact signals block
 * plus at most two knowledge sections. Never the strategist tier.
 *
 * HARD RULE: the model must never claim it can't see the owner's data — the
 * signals block IS their analytics. Three layers enforce it, because prompt
 * text alone demonstrably wasn't enough:
 *   1. the data rides in the USER prompt (not only system_prompt, which a
 *      provider adapter may drop or de-weight),
 *   2. sanitizeHistory() strips old "I can't see your data" agent turns so
 *      the model can't imitate its own past mistake, and
 *   3. guardReply() replaces any disclaimer that still slips through with
 *      the live data block itself.
 *
 * Prompt assembly is pure (unit-tested); the route owns auth and data.
 */
import { llmCall, extractJson } from '../llm';
import { relevantKnowledge } from './knowledge';
import type { AssistantIntent } from './triage';
import { language } from '../language';
import type { UiLocale } from '../i18n';

export type AssistantTurn = { role: 'user' | 'agent'; content: string };

export type AssistantAnswer = {
  thought: string;
  reply: string;
  /** Exact imperative phrase for an action the route can execute (the panel
   *  shows it as a one-tap button; a bare "yes" also runs it). */
  proposedCommand?: string;
};

/** The "I'm an AI without access to your data" reflex, in its usual shapes. */
export const NO_ACCESS_RX = new RegExp(
  [
    "i\\s+(do\\s?n[o']t|can\\s?no?[o']?t|can'?t)\\s+(have\\s+)?(direct\\s+)?(access|see|view)",
    "cannot\\s+see\\s+your\\s+(data|analytics|numbers)",
    "don'?t\\s+have\\s+(direct\\s+)?access\\s+to\\s+your",
    'because\\s+i\\s+am\\s+an\\s+ai',
    'as\\s+an\\s+ai(\\s+(model|assistant|language\\s+model))?[,\\s]',
    "check\\s+your\\s+(own\\s+)?analytics\\s+(platform|dashboard|tool)",
    'google\\s+analytics,\\s*posthog',
    'paste\\s+(them|your\\s+(numbers|data|stats))\\s+here',
  ].join('|'),
  'i',
);

/** Drop old agent turns that carry the disclaimer, so a poisoned transcript
 *  (answers from before the data plumbing existed) can't teach the model to
 *  repeat "I can't see your data" forever. Pure. */
export function sanitizeHistory(history: AssistantTurn[]): AssistantTurn[] {
  return history.filter((t) => !(t.role === 'agent' && NO_ACCESS_RX.test(t.content)));
}

/** Last line of defense: if the model still disclaimed access, answer with
 *  the live data itself instead of ever showing the disclaimer. Pure. */
export function guardReply(answer: AssistantAnswer, signalsMd: string): AssistantAnswer {
  if (!NO_ACCESS_RX.test(answer.reply)) return answer;
  return {
    thought: 'Corrected a bad reply — answering from the live data directly.',
    reply: `I do have your live data — here it is:\n\n${signalsMd.trim()}\n\nAsk me about any line above and I'll break it down.`,
  };
}

/**
 * Turn whatever the model produced into {thought, reply} without EVER
 * leaking raw JSON to the owner. Models drift on the output contract —
 * {"message": "..."} instead of {"reply": "..."} was seen in production —
 * so: known alternate keys are accepted, an unknown object shape falls back
 * to its longest string value, and non-JSON text (fences stripped) is
 * treated as the reply itself. Pure.
 */
const REPLY_KEYS = ['reply', 'message', 'answer', 'response', 'content', 'text'];
const THOUGHT_KEYS = ['thought', 'reasoning', 'thinking'];

export function normalizeAnswer(raw: string): AssistantAnswer {
  let parsed: unknown = null;
  try { parsed = extractJson(raw); } catch { /* not JSON — treated as text below */ }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return '';
    };
    let reply = pick(REPLY_KEYS);
    if (!reply) {
      const strings = Object.values(obj)
        .filter((v): v is string => typeof v === 'string' && !!v.trim())
        .sort((a, b) => b.length - a.length);
      reply = strings[0]?.trim() ?? '';
    }
    if (reply) {
      // Exact key only — the fallback pickers must never promote loose text
      // into something the route would execute.
      const proposal = typeof obj.proposed_command === 'string' ? obj.proposed_command.trim() : '';
      return { thought: pick(THOUGHT_KEYS), reply, proposedCommand: proposal || undefined };
    }
  }

  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return { thought: '', reply: cleaned };
}

export function buildAnswerPrompt(opts: {
  /** UI language of the owner. The agent answers in the language they are
   *  reading the dashboard in — a Korean owner asking a Korean question does
   *  not want an English paragraph back. Separate from the blog's publication
   *  language: this is the conversation, not the article. */
  locale?: UiLocale;
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
The owner is chatting with you in the dashboard sidebar.

The LIVE DATA block in the owner's message is their real analytics — their
first-party reader events, Google Search Console, Google Analytics, and
per-article numbers, queried just now. You DO have access; never say you
don't, never tell them to check an analytics platform — you ARE it. If a
section reads "not connected", that specific source is the only gap: name it
and the one connection that fills it, and answer from everything else.

Answer like a sharp marketing teammate: concrete, plain language, lead with
the direct answer and its number. Keep it tight — a few sentences, or short
"-" bullet lines when comparing articles. Never invent metrics.
- "Am I getting new users / customers / signups?" → answer from the reader
  funnel's converted count and this month's conversions vs last month, plus
  the click-through rate to ${opts.hostname}. Give the actual numbers.
- "Why is traffic lacking?" → diagnose from publish count, impressions vs
  clicks (CTR), organic share, and how young the blog is; give 1-2 next moves.
- Per-article questions ("which content works?") → use the PER-ARTICLE rows.
For setup questions, answer strictly from the GUIDES section and point at
the dashboard page.

THIS REPLY IS WORDS ONLY — you cannot change anything from here. Never say
you did, are doing, or will do something. Actions run through separate
commands: queue a new article ("write an article about <topic>"), revise the
monthly plan ("add two more conversion posts"), rewrite low-CTR titles
("rewrite my low-CTR titles"), approve a draft in review, retry a failed
post, reschedule a post ("move the launch post to Friday"). If the owner
seems to want one of these, put the exact imperative phrase in
"proposed_command" — it becomes a button that actually runs it — and in the
reply say what it will do, not that it's done.

OUTPUT: ONE raw JSON object, no markdown fences:
{"thought":"one short sentence — your reasoning headline","reply":"the message shown to the owner ('-' bullets, numbered lists and **bold** allowed; no headers, no tables)","proposed_command":"omit unless the owner wants an action — then the exact imperative phrase"}`;

  const transcript = sanitizeHistory(opts.history)
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'OWNER' : 'YOU'}: ${t.content}`)
    .join('\n');

  // The data lives in the USER prompt on purpose — see the header comment.
  // The language command goes FIRST in the user prompt, not the system prompt:
  // see lib/language.ts — this model demonstrably ignores a directive at the
  // tail of a long English system prompt.
  const answerLang = language(opts.locale ?? 'en');
  const langLine = answerLang.code === 'en' ? '' :
    `!! ANSWER IN ${answerLang.englishName.toUpperCase()} (${answerLang.nativeName}) !!\nThe owner reads the dashboard in ${answerLang.nativeName}. Write your reply, and the "thought" line, in ${answerLang.nativeName} — natural, not translated. Numbers, metric names, URLs and article titles stay as they are.\n\n`;
  const user = `${langLine}LIVE DATA for ${opts.hostname} (authoritative — queried just now)
${opts.signalsMd || '(no articles or reader events recorded yet — a brand-new blog)'}
${opts.planMd ? `\nCURRENT PLAN MEMO\n${opts.planMd}` : ''}
${guides ? `\nGUIDES\n${guides}` : ''}
${transcript ? `\nRECENT CONVERSATION (may predate the data above — the LIVE DATA always wins)\n${transcript}\n` : ''}
OWNER: ${opts.message}

Answer the owner's last message from the LIVE DATA above. It is real and
current — never claim you lack access to it. Reply with the JSON object.${answerLang.code === 'en' ? '' : `\n\n${langLine.trim()}`}`;

  return { system, user };
}

export async function answerAssistant(opts: {
  hostname: string;
  intent: AssistantIntent;
  message: string;
  signalsMd: string;
  planMd: string;
  history: AssistantTurn[];
  locale?: UiLocale;
}): Promise<AssistantAnswer> {
  const { system, user } = buildAnswerPrompt(opts);
  const { text } = await llmCall({ system, user, maxTokens: 900 });
  return guardReply(normalizeAnswer(text), opts.signalsMd || '(no data recorded yet)');
}
