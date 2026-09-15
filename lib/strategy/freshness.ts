/**
 * Is the plan a domain is LIVING ON the plan the current planner would build?
 *
 * THE FAILURE THIS EXISTS TO END. `ensureMonthlyStrategy` short-circuits to
 * 'exists' on any active plan for the month, and /api/cron/strategy only ever
 * queues domains that aren't covered. Both are right on their own — planning is
 * top-tier spend and rebuilding a good plan hourly would be absurd — but
 * together they mean a plan, once written, is frozen until the 1st of the next
 * month. Ship a planner improvement mid-month and it reaches exactly the
 * domains that happen to have no plan yet.
 *
 * On this account that produced the report "strategy only works on 1 domain".
 * Two verified sites, one owner: www.oveners.com was planned on 2026-09-06 and
 * trygroveai.com was rebuilt by hand on the 13th, the day the keyword ledger
 * (0041) and the customer profile (0042) landed. Grove's strategy page then had
 * 775 keyword candidates behind steps 3-5 and Oven AI's had zero, forever —
 * not because anything failed, but because nothing ever asked the older plan to
 * catch up. Two sites, one of them on the current product.
 *
 * So this answers, from state already on disk, "would the planner build this
 * differently today?" — and the cron uses it as a THIRD priority, strictly
 * behind domains with no plan at all.
 *
 * THE EPOCH IS WHAT STOPS THE LOOP, and it is why the artifact checks alone
 * are not enough. "This plan has no keyword ledger" is a condition a rebuild is
 * supposed to clear — but if the rebuild clears it by failing (research down, a
 * site that can't be crawled), the domain is eligible again on the next tick
 * and every tick after, burning a strategy-tier call an hour forever. Comparing
 * the plan's own `created_at` against the epoch cannot loop: a rebuild always
 * writes a row dated now, which is after the epoch, whatever the rebuild
 * managed to produce. The artifact checks then only narrow that set, so a
 * pre-epoch plan that somehow has everything is left alone.
 *
 * Nothing here calls the network or a database, so the policy is testable
 * without either — same split as rollover.ts, for the same reason.
 */
import { languageVerdict, type LangCode } from '../language';
import { planIsStale } from './rollover';
import type { Strategy } from './build';

/**
 * When the current planning pipeline landed: migrations 0041
 * (keyword_candidates) and 0042 (strategies.customer_profile), both merged
 * 2026-09-13. A plan written before this was built by a planner that could not
 * have produced either artifact.
 *
 * MOVE THIS when a planner change is worth rebuilding live plans for, and only
 * then. It is a release marker, not a clock: raising it asks every domain whose
 * plan predates the new date to spend one strategy-tier call, once.
 */
export const PLAN_PIPELINE_EPOCH = '2026-09-13T00:00:00.000Z';

/**
 * How long after an attempt a domain may be picked for a REFRESH.
 *
 * A missing plan is retried every tick because the domain is publishing
 * nothing; a stale-but-working plan is not an outage, so a domain whose rebuild
 * just failed waits a day rather than spending the platform's best model every
 * hour on a site that cannot be planned. `domains.strategy_attempted_at` (0031)
 * already carries the stamp — this only reads it.
 */
export const REFRESH_COOLDOWN_HOURS = 24;

/**
 * month_ended        — the live plan covers a month that is over (rollover.planIsStale).
 * no_keyword_ledger  — nothing on keyword_candidates points at this plan (pre-0041).
 * no_customer_profile— the plan records no ICP it was built for (pre-0042).
 * language_mismatch  — the plan is confidently not in the domain's publication language.
 */
export type StaleReason =
  | 'month_ended'
  | 'no_keyword_ledger'
  | 'no_customer_profile'
  | 'language_mismatch';

/**
 * A language mismatch is NOT in here, and that is a product decision rather
 * than an oversight.
 *
 * When a plan and `domains.language` disagree, neither half is automatically
 * the wrong one, and www.oveners.com is the live example of how genuinely
 * ambiguous it gets. `language` says 'en'. The site published 58 English
 * articles from June through August, then switched to Korean on 2026-08-31 and
 * has published 11 Korean ones since — because the September plan came back in
 * Korean and pillar titles and slot topics are handed to the writer verbatim.
 * So either the column is stale and this is a Korean blog now, or the plan
 * drifted and three months of English is the real site. Rebuilding assumes the
 * second; leaving it assumes the first; both are guesses about what the owner
 * wants their blog to be. That is not a call code gets to make, so this
 * surfaces the disagreement and never acts on it — the owner settles it on
 * /dashboard/voice, and a rebuild then follows the language they chose.
 *
 * Worth recording: `WRONG_LANGUAGE` in lib/pipeline/validator is blocking and
 * did NOT stop those 11 — which means the column was still 'ko' when they were
 * written and changed to 'en' afterwards. The plan is the artifact left behind
 * by that change, exactly as CLAUDE.md warns ("a stored artifact is never
 * retranslated"), and it keeps producing Korean titles until it is rebuilt.
 */
export const AUTO_REBUILD_REASONS: readonly StaleReason[] = [
  'month_ended',
  'no_keyword_ledger',
  'no_customer_profile',
] as const;

export type PlanFreshness = {
  /** Everything true of this plan, for the owner to read. */
  reasons: StaleReason[];
  /** Any reason at all — drives the tracker's "rebuild" action. */
  stale: boolean;
  /** May the hourly cron rebuild this unasked? See AUTO_REBUILD_REASONS. */
  autoRebuild: boolean;
};

export type FreshnessInput = {
  /** strategies.month, as Postgres returns a `date` ('YYYY-MM-DD'). */
  month: string | null | undefined;
  /** strategies.created_at — the plan's own age, checked against the epoch. */
  createdAt: string | null | undefined;
  /** Any keyword_candidates row carrying this plan's strategy_id. */
  hasKeywordLedger: boolean;
  /** strategies.customer_profile holds a profile. */
  hasCustomerProfile: boolean;
  /** The plan itself — its reader-facing text is the language evidence. */
  strategy: Pick<Strategy, 'pillars' | 'publishing_plan'> | null | undefined;
  /** domains.language: what this blog is configured to publish in. */
  lang: LangCode;
  now?: Date;
  epoch?: string;
};

/**
 * The plan's reader-facing text, as one blob for the language check.
 *
 * Pillar titles and slot topics only: they are handed to the writer verbatim
 * and become article titles, so they are the half of a plan that MUST be in the
 * publication language. Goals and notes are addressed to the owner and follow
 * the UI language instead (see CLAUDE.md — the strategy is the one artifact
 * with two languages), so including them would report a mismatch on a plan that
 * is correctly bilingual.
 */
export function planReaderText(
  strategy: Pick<Strategy, 'pillars' | 'publishing_plan'> | null | undefined,
): string {
  const pillars = (strategy?.pillars ?? []).map((p) => p?.title ?? '');
  const slots = (strategy?.publishing_plan ?? []).flatMap((s) => [s?.topic ?? '', s?.target_keyword ?? '']);
  return [...pillars, ...slots].filter(Boolean).join('. ');
}

/**
 * Is the plan written in the language the blog publishes in?
 *
 * Deliberately reuses `languageVerdict` rather than inventing a second rule:
 * it is script-based, already tested, and abstains ('unsure') instead of
 * guessing — which is what a short plan, or a Latin-script pair like en/es
 * that no character can tell apart, should get. Only a confident 'wrong'
 * counts, so the quiet answer is always "leave it alone".
 */
export function planLanguageMatches(
  strategy: Pick<Strategy, 'pillars' | 'publishing_plan'> | null | undefined,
  lang: LangCode,
): boolean {
  return languageVerdict(planReaderText(strategy), lang) !== 'wrong';
}

/** Was this plan built by a planner older than the current pipeline? */
export function planPredatesPipeline(createdAt: string | null | undefined, epoch = PLAN_PIPELINE_EPOCH): boolean {
  if (!createdAt) return false;              // unknown age — never rebuild on a guess
  const t = Date.parse(String(createdAt));
  return Number.isFinite(t) && t < Date.parse(epoch);
}

/** Everything that is out of date about the plan a domain is living on. */
export function planFreshness(input: FreshnessInput): PlanFreshness {
  const now = input.now ?? new Date();
  const epoch = input.epoch ?? PLAN_PIPELINE_EPOCH;
  const reasons: StaleReason[] = [];

  if (planIsStale(input.month, now)) reasons.push('month_ended');

  // The artifact checks apply only to plans from before the pipeline that
  // produces them. After the epoch a missing ledger means the research found
  // nothing for this site, which a rebuild would not change — and which the
  // tracker already reports honestly as an empty step.
  if (planPredatesPipeline(input.createdAt, epoch)) {
    if (!input.hasKeywordLedger) reasons.push('no_keyword_ledger');
    if (!input.hasCustomerProfile) reasons.push('no_customer_profile');
  }

  if (!planLanguageMatches(input.strategy, input.lang)) reasons.push('language_mismatch');

  return {
    reasons,
    stale: reasons.length > 0,
    autoRebuild: reasons.some((r) => AUTO_REBUILD_REASONS.includes(r)),
  };
}

/** Has enough time passed since the last build attempt to try a refresh? */
export function refreshCooledDown(
  attemptedAt: string | null | undefined,
  now: Date,
  cooldownHours = REFRESH_COOLDOWN_HOURS,
): boolean {
  if (!attemptedAt) return true;             // never attempted — nothing to wait for
  const t = Date.parse(String(attemptedAt));
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= cooldownHours * 3_600_000;
}
