/**
 * Who owns the `stripe_events` idempotency row for this delivery?
 *
 * The webhook claims a row before processing so two concurrent deliveries of
 * the same Stripe event can't both run the handler. The subtlety is what has
 * to happen when processing then FAILS: the claim must be released, or Stripe's
 * retry hits the unique-violation short-circuit and the event is dropped
 * forever. Since this webhook is the only writer of subscription entitlement,
 * a dropped event means a customer paid and never got access.
 *
 * Getting that right depends on telling three insert outcomes apart, and only
 * one of them may be released. Pure so the distinction is testable without a
 * database, a Stripe signature, or a live webhook.
 */

/** Postgres unique_violation — the row was already there. */
export const UNIQUE_VIOLATION = '23505';

export type ClaimState =
  /** Someone already processed (or is processing) this event — skip it. */
  | 'duplicate'
  /** We inserted the row. We own it, so we may release it on failure. */
  | 'claimed'
  /** The insert failed for some other reason (e.g. the table isn't migrated).
   *  Nothing of ours exists to release — deleting here could remove a row a
   *  concurrent invocation legitimately owns. Process anyway: dropping real
   *  billing events is worse than processing one twice, and the handler's
   *  writes are last-write-wins patches. */
  | 'unclaimed';

export function classifyClaim(err: { code?: string } | null | undefined): ClaimState {
  if (!err) return 'claimed';
  return err.code === UNIQUE_VIOLATION ? 'duplicate' : 'unclaimed';
}

/** Should this delivery short-circuit without running the handler? */
export function isDuplicate(state: ClaimState): boolean {
  return state === 'duplicate';
}

/**
 * On handler failure, may we delete the idempotency row?
 *
 * Only when we put it there. This is the single line that turns a permanent
 * silent drop into a retry that actually runs.
 */
export function shouldReleaseClaim(state: ClaimState): boolean {
  return state === 'claimed';
}
