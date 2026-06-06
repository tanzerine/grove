/**
 * Manager rubric — readable, version-controllable rules the evaluator
 * uses to decide approve / rewrite / reject. The LLM gets this verbatim,
 * so changes here directly steer the manager's behavior.
 *
 * Keep it tight. Every rule must be checkable from the draft + brief +
 * strategy alone, without external lookups.
 */

export type RubricRule = {
  id: string;
  scope: 'strategic' | 'marketing' | 'craft' | 'safety';
  severity: 'block' | 'rewrite' | 'note';
  rule: string;
};

export const MANAGER_RUBRIC: RubricRule[] = [
  // ── strategic fit (blocks if missed) ───────────────────────
  {
    id: 'pillar_alignment',
    scope: 'strategic',
    severity: 'block',
    rule: 'Article must clearly belong to its assigned pillar. The pillar promise should be visible by paragraph 3.',
  },
  {
    id: 'audience_fit',
    scope: 'strategic',
    severity: 'block',
    rule: 'Every example, anecdote, and CTA must serve the pillar audience. No off-target personas (e.g. hobbyists when the audience is product teams).',
  },
  {
    id: 'kpi_relevance',
    scope: 'strategic',
    severity: 'rewrite',
    rule: 'The article structure must support its assigned KPI. For organic_share → strong on-page SEO scaffolding. For conversions → clear product relevance. For median_dwell_sec → narrative depth and pacing.',
  },
  {
    id: 'no_off_limits',
    scope: 'strategic',
    severity: 'block',
    rule: 'Article must not touch any off-limits topic, competitor, or framing the owner flagged.',
  },

  // ── marketing intent execution ─────────────────────────────
  {
    id: 'intent_editorial',
    scope: 'marketing',
    severity: 'rewrite',
    rule: 'If marketing_intent = editorial: the brand name must NOT appear, and no link to the homepage should exist.',
  },
  {
    id: 'intent_contextual',
    scope: 'marketing',
    severity: 'rewrite',
    rule: 'If marketing_intent = contextual: brand name appears exactly once as an inline link, no closing CTA paragraph.',
  },
  {
    id: 'intent_conversion',
    scope: 'marketing',
    severity: 'rewrite',
    rule: 'If marketing_intent = conversion: brand named in lead, one feature referenced mid-piece, closing CTA paragraph with brand-as-link present. CTA verb must NOT be "try / sign up / check out / click here".',
  },
  {
    id: 'cta_offer_match',
    scope: 'marketing',
    severity: 'rewrite',
    rule: 'If a conversion offer is defined in strategy, the conversion CTA must point to that offer (or be silent on it). Do not invent offers.',
  },

  // ── craft ─────────────────────────────────────────────────
  {
    id: 'lead_treatment',
    scope: 'craft',
    severity: 'rewrite',
    rule: 'Opens with a short italicized lead (1-2 sentences) before the main hook. Lead is sharp, not throat-clearing.',
  },
  {
    id: 'pull_quote',
    scope: 'craft',
    severity: 'note',
    rule: 'Has one mid-article pull quote (a > blockquote on a single sharp claim, ≤ 16 words).',
  },
  {
    id: 'no_banned_phrases',
    scope: 'craft',
    severity: 'rewrite',
    rule: 'No AI-tell phrases: "in today\'s fast-paced world", "in the realm of", "delve", "elevate", "transformative", etc.',
  },
  {
    id: 'specifics',
    scope: 'craft',
    severity: 'rewrite',
    rule: 'Contains at least one concrete specific (real number, real product, real workflow, real anecdote). No generic claims throughout.',
  },
  {
    id: 'structure_balance',
    scope: 'craft',
    severity: 'note',
    rule: 'Uses H2 for major sections. Lists/tables used where appropriate, not gratuitously.',
  },

  // ── safety ─────────────────────────────────────────────────
  {
    id: 'no_unsourced_claims',
    scope: 'safety',
    severity: 'block',
    rule: 'Any specific number, study finding, regulatory rule, or direct quote needs a citation. No fabricated statistics.',
  },
  {
    id: 'no_pii',
    scope: 'safety',
    severity: 'block',
    rule: 'No real names, emails, or identifiers that weren\'t in the source material.',
  },
];

/** Format the rubric for LLM consumption. Stable order, terse. */
export function rubricPromptBlock(): string {
  return MANAGER_RUBRIC.map(
    (r) => `[${r.id}] (${r.scope}, ${r.severity}) — ${r.rule}`,
  ).join('\n');
}
