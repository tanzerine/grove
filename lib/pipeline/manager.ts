/**
 * Manager agent — the gate between draft and publish.
 *
 * It reads the active strategy, the brief, and the writer's draft, scores
 * the draft against the rubric, and decides one of:
 *
 *   approve  — ship it. Persist as 'review' or 'scheduled'.
 *   rewrite  — call the writer once more with targeted notes.
 *   reject   — kill the draft; topic was off-strategy.
 *
 * The rewrite loop runs at most once. On round 2 the manager must
 * either approve or reject — no infinite ping-pong.
 */
import { llmCall, extractJson } from '../llm';
import { rubricPromptBlock } from './manager-rubric';
import type { RefinedBrief } from './topic-refiner';
import type { Strategy, Pillar, PostSlot } from '../strategy/build';

export type EvaluationIssue = {
  rule: string;           // rubric rule id
  severity: 'block' | 'rewrite' | 'note';
  note: string;
};

export type Evaluation = {
  action: 'approve' | 'rewrite' | 'reject';
  pass: boolean;          // true only when action === 'approve'
  scores: {
    strategic_fit: number;     // 0-100
    marketing: number;          // 0-100
    craft: number;              // 0-100
    safety: number;             // 0-100
    overall: number;            // 0-100, weighted
  };
  issues: EvaluationIssue[];
  rewrite_brief?: string;       // present when action === 'rewrite'
  reject_reason?: string;       // present when action === 'reject'
};

export type ManagerInput = {
  attempt: 1 | 2;
  brief: RefinedBrief;
  draft: { body_md: string; meta_title: string; meta_description: string };
  strategy?: Strategy | null;
  slot?: PostSlot | null;       // the publishing_plan slot this article was meant to fill
};

/** Overall score below this routes the draft to human review instead of
 *  auto-publish. 70 is the rubric's own "solid and publishable" anchor —
 *  gating below the bar we tell the model publishable work sits at would
 *  make the floor decorative. Shared with generate.ts routing. */
export const QUALITY_FLOOR = 70;

/**
 * Compute the rubric scores from the model's raw axis ratings.
 * - Missing/garbled axes are filled with a neutral 70 so the weighted overall
 *   still computes, but callers MUST check missingAxes(): a glitch is flagged
 *   as an integrity issue and routed to human review — it must never silently
 *   read as "publishable article" (nor as "terrible article").
 * - overall is weighted in code; when there's no active strategy, strategic_fit
 *   is dropped from the weighting (nothing to grade it against).
 */
export function computeScores(
  raw: any,
  hasStrategy: boolean,
): { strategic_fit: number; marketing: number; craft: number; safety: number; overall: number } {
  const clamp = (n: any, dflt = 70) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : dflt;
  };
  const sub = {
    strategic_fit: hasStrategy ? clamp(raw?.strategic_fit) : clamp(raw?.strategic_fit, 75),
    marketing: clamp(raw?.marketing),
    craft: clamp(raw?.craft),
    safety: clamp(raw?.safety),
  };
  const w = hasStrategy
    ? { strategic_fit: 0.30, marketing: 0.25, craft: 0.30, safety: 0.15 }
    : { strategic_fit: 0.00, marketing: 0.35, craft: 0.50, safety: 0.15 };
  const overall = Math.round(
    sub.strategic_fit * w.strategic_fit + sub.marketing * w.marketing +
    sub.craft * w.craft + sub.safety * w.safety,
  );
  return { ...sub, overall };
}

/**
 * Axes the model failed to score (absent / non-numeric). strategic_fit is
 * exempt when there's no strategy — its weight is zero, nothing was graded.
 * A non-empty result means the evaluation is unreliable: the caller attaches
 * a block-severity evaluation_integrity issue so the draft goes to human
 * review instead of publishing on fabricated neutral numbers.
 */
export function missingAxes(raw: any, hasStrategy: boolean): string[] {
  const axes = hasStrategy
    ? ['strategic_fit', 'marketing', 'craft', 'safety']
    : ['marketing', 'craft', 'safety'];
  return axes.filter((a) => !Number.isFinite(Number(raw?.[a])));
}

export async function evaluateDraft(input: ManagerInput): Promise<Evaluation> {
  const { attempt, brief, draft, strategy, slot } = input;
  const pillar = slot && strategy
    ? strategy.pillars.find((p) => p.id === slot.pillar_id) ?? null
    : null;

  const system = `You are the managing editor for a small business blog.
Your job is to gate publication: decide whether a draft serves the active
strategy, fits the audience, executes its marketing intent correctly, and
meets the craft bar.

You evaluate against the RUBRIC below. For each rule, decide if the draft
passes. Surface only violations — don't list passing rules.

DECIDE
- 'approve' if there are no block-severity issues AND no more than 2
  rewrite-severity issues. note-severity issues never block.
- 'reject' ONLY when the article is off-strategy at the topic level
  (wrong pillar, off-limits topic, audience completely wrong). Reserved
  for the rare case where rewriting won't fix it.
- 'rewrite' otherwise. Always include rewrite_brief with concrete edit
  instructions targeted at the specific issues you flagged.

This is attempt ${attempt} of at most 2. On attempt 2 you MUST choose
'approve' or 'reject' — never 'rewrite' again.

SCORES — rate each axis 0-100 on an ABSOLUTE craft scale (NOT as a pass/fail gate).
Anchors:
- 85-100 = excellent, ship as-is
- 70-84 = solid and publishable — where a competent, on-topic, specific draft lands
- 50-69 = usable but has clear weaknesses
- below 50 = real, nameable problems
Axes:
- strategic_fit: does it serve the pillar/audience? If there is NO active strategy,
  score this 75 (there is nothing to violate) — do NOT tank it to 0.
- marketing: intent execution + CTA discipline
- craft: lead, specifics, voice, structure, no banned phrases
- safety: citations where needed, no fabricated stats, no PII
Score honestly against the anchors above — every score must be justified by
evidence you could quote from the draft, high or low. Do not anchor to any
"typical" band in either direction.
You provide the four axis scores; the SYSTEM computes the weighted overall — so
just rate the axes accurately, don't compute an overall yourself.

OUTPUT: ONE raw JSON object, no preamble, no markdown.

RUBRIC
${rubricPromptBlock()}`;

  const user = `STRATEGY CONTEXT
${strategy ? JSON.stringify({
    goals: strategy.goals,
    pillars: strategy.pillars.map((p) => ({ id: p.id, title: p.title, audience: p.audience, promise: p.promise })),
    notes: strategy.notes,
  }) : '(no active strategy — evaluate against brief alone)'}

THIS SLOT
${slot ? JSON.stringify(slot) : '(no slot — ad-hoc article)'}

PILLAR
${pillar ? JSON.stringify(pillar) : '(no pillar)'}

BRIEF
${JSON.stringify({
    title: brief.title,
    angle: brief.angle,
    format: brief.format,
    marketing_intent: brief.marketing_intent,
    promise: brief.promise,
    must_include: brief.must_include,
  })}

DRAFT META
title: ${draft.meta_title}
meta_description: ${draft.meta_description}

DRAFT BODY
${draft.body_md.slice(0, 14_000)}

Return JSON:
{
  "action": "approve | rewrite | reject",
  "pass": true|false,
  "scores": { "strategic_fit": <0-100>, "marketing": <0-100>, "craft": <0-100>, "safety": <0-100> },
  "issues": [{ "rule": "rule_id", "severity": "block|rewrite|note", "note": "specific quoted evidence + what to change" }],
  "rewrite_brief": "if action=rewrite, concrete edit instructions (3-6 bullet points). Empty otherwise.",
  "reject_reason": "if action=reject, one sentence. Empty otherwise."
}`;

  const { text } = await llmCall({ system, user, json: true, maxTokens: 2500 });
  const parsed = extractJson<Evaluation>(text);

  // ── normalize ────────────────────────────────────────────
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];

  // Evaluation integrity: a garbled action or missing axis scores means we do
  // NOT actually know what the manager thought. Never let a tooling glitch
  // read as a clean approval — attach a block-severity issue so generate.ts
  // routes the draft to human review with honest numbers-are-unreliable framing.
  const validAction = ['approve', 'rewrite', 'reject'].includes(parsed.action);
  const missing = missingAxes(parsed.scores, !!strategy);
  if (!validAction || missing.length) {
    parsed.issues.push({
      rule: 'evaluation_integrity',
      severity: 'block',
      note: !validAction
        ? `model returned unusable action ${JSON.stringify(parsed.action)} — verdict unknown, needs a human`
        : `model omitted axis scores (${missing.join(', ')}) — displayed scores are neutral fillers, not real grades`,
    });
  }
  if (!validAction) parsed.action = 'approve'; // keep the draft; the block issue forces review

  // Compute the overall in code (never trust the model's arithmetic) with
  // strategy-aware weights and neutral fillers for missing axes (flagged above).
  parsed.scores = computeScores(parsed.scores, !!strategy);

  // Score floor: gating was action-driven, so the LLM could return a low
  // overall AND action:"approve", shipping a weak draft. On attempt 1, force a
  // rewrite when the score is below the bar so the quality pass actually fires.
  if (attempt === 1 && parsed.action === 'approve' && (parsed.scores.overall ?? 0) < QUALITY_FLOOR) {
    parsed.action = 'rewrite';
    if (!parsed.rewrite_brief) {
      const top = parsed.issues.filter((i) => i.severity !== 'note').slice(0, 4).map((i) => `- ${i.note}`).join('\n');
      parsed.rewrite_brief =
        `Overall quality ${parsed.scores.overall ?? 0}/100 is below the ${QUALITY_FLOOR} bar. Raise it by fixing:\n` +
        (top || '- thin specifics, weak argument, or off-voice prose — add concrete detail and sharpen the angle.');
    }
  }

  // Force consistency: pass mirrors action.
  //
  // NOTE: if attempt 2 still returns 'rewrite' (the prompt forbids it, but the
  // model may disobey), the verdict is persisted AS-IS — an unresolved rewrite,
  // pass=false. We used to launder it into approve/pass=true here; that wrote a
  // dishonest record. The draft is still never discarded: generate.ts routes
  // any non-approve action to human review instead of auto-publishing.
  parsed.pass = parsed.action === 'approve';

  return parsed;
}

/**
 * Compose the rewrite prompt fed to runWriter for round 2.
 * Surfaces only the issues the manager flagged at rewrite-or-block severity.
 */
export function composeRewriteInstructions(ev: Evaluation): string {
  const actionable = ev.issues.filter((i) => i.severity !== 'note');
  const bullets = actionable.map((i) => `- [${i.rule}] ${i.note}`).join('\n');
  return `MANAGER REWRITE NOTES (apply these surgically, keep what works):
${bullets}

${ev.rewrite_brief ?? ''}`.trim();
}
