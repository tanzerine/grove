/**
 * May this domain turn autopilot ON yet?
 *
 * Autopilot publishes to the customer's live site with no human in the loop,
 * and the reputational cost of bad AI content on someone's own domain is
 * asymmetric: one embarrassing post does more damage than ten good ones earn.
 *
 * Everything about the product already assumed a review-first first run —
 * auto_publish defaults false, onboarding step 6 is literally "Review the
 * scheduled post" — but nothing ENFORCED it. The autopilot pill sits in the nav
 * on every dashboard page from minute one, and the settings API took
 * `auto_publish: true` with no preconditions at all. A brand-new account could
 * therefore flip it on before grove had ever shown them a single sentence it
 * writes, and the first article they read would be one already on their site.
 *
 * So the gate is exactly one requirement: the pipeline must have finished at
 * least one draft on this domain, in a status the owner can actually open. Not
 * "did they click it" — that is unknowable and would strand anyone who reviews
 * by email — but "does output exist for them to judge". After that first draft
 * they have seen the product's real voice and the choice is genuinely theirs.
 */

/** Statuses that mean a finished draft exists and the owner can read it.
 *  `scheduled` and `published` count because both imply a draft was completed
 *  and (for published) very likely approved by hand. Working statuses do not:
 *  a post mid-research is not something anyone can judge. */
export const REVIEWABLE_STATUSES = ['review', 'scheduled', 'published'] as const;

export type AutopilotGate = { allowed: boolean; reason?: string };

export function canEnableAutopilot(input: { finishedDrafts: number }): AutopilotGate {
  if (input.finishedDrafts > 0) return { allowed: true };
  return {
    allowed: false,
    reason:
      'Autopilot publishes straight to your live site. Grove needs to show you one finished draft first — review it, then switch autopilot on and it will handle the rest.',
  };
}
