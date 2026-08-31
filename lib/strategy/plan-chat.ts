/**
 * Plan chat — the owner steers the active plan in plain language.
 *
 * COST BREAKER DESIGN. The chat is deliberately fire-walled from the main
 * agent loop so conversation can never multiply loop cost:
 *
 *   1. Deterministic triage (no LLM) splits messages into question | revision.
 *   2. Questions are answered by the FAST model reading the ~500-token plan
 *      memo + progress log — never the strategist model, never the full loop.
 *   3. Revisions are ONE strategist-model call that edits the existing plan
 *      JSON in place — no research, no keyword crawl, no report aggregation,
 *      no post regeneration. The scheduler simply materializes changed slots
 *      on its next tick.
 *   4. Hard monthly caps (PLAN_CHAT_LIMITS) are enforced in the API route by
 *      counting persisted chat rows, so the ceiling survives serverless
 *      restarts and can't be bypassed client-side.
 *
 * Pure logic (triage, merge) lives here and is unit-tested; the route owns
 * auth, budget counting, and persistence.
 */
import { strategyLlmCall, fastLlmCall, llmCall, extractJson } from '../llm';
import { normalizeStrategy, type Strategy } from './build';
import { monthlySlots } from '../plans';
import { language, strategyLanguageRule, type LangCode } from '../language';
import type { UiLocale } from '../i18n';

export const PLAN_CHAT_LIMITS = {
  messagesPerMonth: 40,    // total owner messages (questions are near-free, this stops abuse)
  revisionsPerMonth: 8,    // strategist-model calls — the only expensive path (~$0.40 each)
} as const;

/* ────────────────────────────── triage ─────────────────────────────── */

export type PlanMessageKind = 'question' | 'revision';

const QUESTION_STARTS = /^(why|what|how|when|who|where|which|is|are|do|does|did|explain|왜|뭐|무엇|어떻게|언제|누가|어디)\b/i;
const REVISION_HINTS = new RegExp(
  [
    'change', 'replace', 'swap', 'add', 'remove', 'drop', 'delete', 'cancel',
    'instead', 'more', 'less', 'fewer', 'focus', 'shift', 'move', 'reschedule',
    'increase', 'decrease', 'prioriti[sz]e', 'avoid', 'stop writing', "don'?t write",
    // Korean owners are a core segment — cover the common steering verbs.
    '바꿔', '바꾸', '변경', '추가', '빼', '삭제', '제거', '줄여', '줄이', '늘려', '늘리', '대신', '집중', '위주로', '그만',
  ].join('|'),
  'i',
);

/**
 * Deterministic (testable, zero-cost) message triage. Interrogative openers
 * win — "why did you add X?" is a question even though it contains "add" —
 * otherwise any steering verb routes to the revision path. Default is
 * 'question' because that's the cheap path.
 */
export function classifyPlanMessage(message: string): PlanMessageKind {
  const m = message.trim();
  if (QUESTION_STARTS.test(m)) return 'question';
  if (REVISION_HINTS.test(m)) return 'revision';
  return 'question';
}

/* ─────────────────────── question path (cheap) ─────────────────────── */

export async function answerPlanQuestion(opts: {
  message: string;
  contextMd: string;           // plan memo + progress log, already token-capped
  hostname: string;
  /** The owner's UI language. This is a conversation with them, not content —
   *  it follows what they read grove in, not what the blog publishes in. */
  locale?: UiLocale;
}): Promise<string> {
  const chatLang = language(opts.locale ?? 'en');
  // First line of the USER turn, not the system prompt: see lib/language.ts.
  const langCommand = chatLang.code === 'en' ? '' :
    `!! REPLY IN ${chatLang.englishName.toUpperCase()} (${chatLang.nativeName}) !!\nThe plan memo below is in whatever language it was written in; your ANSWER is for the owner and must be ${chatLang.nativeName}. Numbers, metric names and article titles stay as they are.\n\n`;
  const system = `You are Grove, the marketing agent running the blog for ${opts.hostname}.
The owner is asking about the current plan. Answer from the plan memo and
progress log below — concretely, in 1-4 short sentences, plain language, no
jargon, no hedging. If they seem to want a CHANGE to the plan, tell them to
say the change directly (e.g. "add two more conversion posts") and you'll
apply it. Never invent numbers that aren't in the memo.

PLAN MEMO + PROGRESS LOG
${opts.contextMd}`;

  try {
    const { text } = await fastLlmCall({ system, user: `${langCommand}${opts.message}`, maxTokens: 400 });
    return text.trim();
  } catch {
    // Fast model down → workhorse model, still never the strategist tier.
    const { text } = await llmCall({ system, user: `${langCommand}${opts.message}`, maxTokens: 400 });
    return text.trim();
  }
}

/* ─────────────────────── revision path (Opus, capped) ───────────────────── */

export type RevisionOutcome = {
  reply: string;
  strategy: Strategy;
};

/** Compact projection of the current plan — everything the reviser may edit,
 *  nothing it doesn't need (evaluations, reports, etc. stay out of the prompt). */
function planForPrompt(s: Strategy): string {
  return JSON.stringify({
    month: s.month,
    goals: s.goals,
    kpis: s.kpis,
    pillars: s.pillars,
    publishing_plan: (s.publishing_plan ?? []).map((sl) => ({
      id: sl.id, pillar_id: sl.pillar_id, goal_id: sl.goal_id, kpi_id: sl.kpi_id,
      topic: sl.topic, intent: sl.intent, target_keyword: sl.target_keyword,
      publish_date: sl.publish_date,
    })),
    direction: s.direction,
    notes: s.notes,
  });
}

export async function reviseStrategy(opts: {
  current: Strategy;
  instruction: string;
  hostname: string;
  postsPerWeek: number;
  lockedSlotIds?: string[];    // slots with a post already drafted/published
  monthlyQuota?: number | null; // plan allowance; the revision can't exceed it
  /** Blog's publication language — anything edited here that becomes an
   *  article (slot topics, pillar titles, keywords) must stay in it. */
  lang?: LangCode;
  /** Owner's UI language — the reply and the plan's commentary. */
  locale?: UiLocale;
}): Promise<RevisionOutcome> {
  const { current, instruction, hostname, postsPerWeek, lockedSlotIds = [], monthlyQuota = null } = opts;
  const langRule = strategyLanguageRule(opts.lang ?? 'en', opts.locale ?? opts.lang ?? 'en');

  const system = `You are the strategist agent for the ${hostname} blog. The owner
wants to change the ACTIVE monthly plan. Apply their instruction as a surgical
edit — this is a revision, not a re-plan:

- Keep every slot the instruction doesn't touch EXACTLY as-is (same id, same
  topic, same publish_date).
- LOCKED slot ids (already drafted or published — must not be removed or
  retopiced): ${lockedSlotIds.length ? lockedSlotIds.join(', ') : '(none)'}
- New slots get a fresh id and no publish_date (the scheduler dates them).
- KPI metrics must stay within: views, unique_sessions, median_dwell_sec,
  scroll_completion_rate, outbound_to_product_rate, conversions,
  organic_share, newsletter_signups.
- Keep the month unchanged. Update "direction" and "notes" so they match the
  revised plan.
- If the instruction is unclear or would hurt the owner's own stated goal,
  make the closest sensible change and say so in the reply.

OUTPUT: ONE raw JSON object, no markdown:
{ "reply": "1-3 plain sentences confirming exactly what changed",
  "strategy": { month, goals, kpis, pillars, publishing_plan, direction, notes } }`;

  // Language first in the user turn, as everywhere else in this codebase.
  const user = `${langRule ? `${langRule}\n\n` : ''}CURRENT PLAN:\n${planForPrompt(current)}\n\nOWNER'S CHANGE REQUEST:\n${instruction}${langRule ? `\n\nWrite "reply" in the language the owner reads grove in.` : ''}`;

  const { text } = await strategyLlmCall({ system, user, maxTokens: 4500 });
  const parsed = extractJson<{ reply?: string; strategy?: Strategy }>(text);
  if (!parsed.strategy) throw new Error('reviseStrategy: no strategy in response');

  const merged = mergeRevision(current, parsed.strategy, { postsPerWeek, lockedSlotIds, monthlyQuota });
  return {
    reply: (parsed.reply ?? 'Done — the plan has been updated.').trim(),
    strategy: merged,
  };
}

/**
 * Merge an LLM-proposed revision onto the current plan. Pure + unit-tested:
 *   - slots that kept their id inherit their original publish_date
 *   - locked slots (posts already exist) are restored if the model dropped them
 *   - slot count is capped so a chat message can't silently double spend
 *   - then the shared normalizeStrategy guardrails run (dangling refs, dates)
 */
export function mergeRevision(
  current: Strategy,
  proposed: Strategy,
  opts: { postsPerWeek: number; lockedSlotIds?: string[]; monthlyQuota?: number | null },
): Strategy {
  const { postsPerWeek, lockedSlotIds = [], monthlyQuota = null } = opts;
  const currentById = new Map((current.publishing_plan ?? []).map((s) => [s.id, s]));

  let plan = (proposed.publishing_plan ?? []).map((slot) => {
    const prev = slot.id ? currentById.get(slot.id) : undefined;
    return prev && !slot.publish_date ? { ...slot, publish_date: prev.publish_date } : slot;
  });

  // Restore locked slots the model removed — a chat edit must never orphan a
  // post that's already drafted or live.
  const proposedIds = new Set(plan.map((s) => s.id));
  for (const id of lockedSlotIds) {
    const original = currentById.get(id);
    if (original && !proposedIds.has(id)) plan = [original, ...plan];
  }

  // The owner can ask for a bigger month, but never past what their plan
  // includes — this is the spend guarantee, and the chat can't lift it. With no
  // enforceable allowance the old cadence-relative headroom (up to 2x) stands.
  const monthlyPostCount = monthlySlots(postsPerWeek, monthlyQuota);
  const quotaBound = typeof monthlyQuota === 'number' && monthlyQuota > 0;
  // Never below the locked count: trimming to the allowance must not orphan a
  // slot whose post is already drafted or live (a month's plan can legitimately
  // sit above the allowance if it was built before the cap existed).
  const maxSlots = quotaBound
    ? Math.max(monthlyPostCount, lockedSlotIds.length)
    : Math.min(Math.max(monthlyPostCount, plan.length), monthlyPostCount * 2);

  return normalizeStrategy(
    { ...proposed, publishing_plan: plan },
    { month: current.month, source: 'revised', maxSlots, postsPerWeek },
  );
}
