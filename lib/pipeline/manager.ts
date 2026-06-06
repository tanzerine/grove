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

SCORES (0-100, be honest):
- strategic_fit: pillar/audience/KPI alignment
- marketing: intent execution + CTA discipline
- craft: lead, pull-quote, specifics, banned phrases
- safety: citations, no fabricated stats, no PII
- overall: weighted (strategic_fit 40%, marketing 25%, craft 25%, safety 10%)

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
  "scores": { "strategic_fit": 0, "marketing": 0, "craft": 0, "safety": 0, "overall": 0 },
  "issues": [{ "rule": "rule_id", "severity": "block|rewrite|note", "note": "specific quoted evidence + what to change" }],
  "rewrite_brief": "if action=rewrite, concrete edit instructions (3-6 bullet points). Empty otherwise.",
  "reject_reason": "if action=reject, one sentence. Empty otherwise."
}`;

  const { text } = await llmCall({ system, user, json: true, maxTokens: 2500 });
  const parsed = extractJson<Evaluation>(text);

  // ── normalize ────────────────────────────────────────────
  parsed.action = ['approve', 'rewrite', 'reject'].includes(parsed.action) ? parsed.action : 'approve';
  parsed.issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  parsed.scores = parsed.scores ?? { strategic_fit: 0, marketing: 0, craft: 0, safety: 0, overall: 0 };

  // Force consistency: pass mirrors action.
  parsed.pass = parsed.action === 'approve';

  // Round 2 may NOT request another rewrite.
  if (attempt === 2 && parsed.action === 'rewrite') {
    const hasBlocking = parsed.issues.some((i) => i.severity === 'block');
    parsed.action = hasBlocking ? 'reject' : 'approve';
    parsed.pass = parsed.action === 'approve';
    parsed.reject_reason = hasBlocking
      ? 'blocking issues remained after one rewrite attempt'
      : parsed.reject_reason;
  }

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
