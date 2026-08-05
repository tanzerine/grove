/**
 * Job-level idempotency keys for draft creation.
 *
 * The problem is narrow and specific: one customer intent ("write me an article
 * about X") must buy exactly one post, no matter how many times the request
 * arrives. It arrives more than once more often than you would think — a
 * double-click, a fetch the browser retried, two tabs, a user reloading a page
 * that POSTs on mount.
 *
 * The key is derived on the SERVER from what the request means rather than from
 * anything the client sends. A client-supplied token would work only for
 * clients that remember to send one, and would be trivially defeated by the
 * very retry paths it is meant to survive.
 *
 * THE TIME BUCKET is what keeps this from becoming a permanent ban on ever
 * writing about a topic twice. Two requests collapse only when they land in the
 * same window; ask again tomorrow and you get a second article, which is a
 * legitimate thing to want. `keyCandidates` covers the boundary — without it,
 * two clicks 200ms apart that straddle a bucket edge would both go through, and
 * the edge case would be rare enough to never get diagnosed.
 */
import { createHash } from 'node:crypto';

/**
 * How long one intent stays deduplicated.
 *
 * Two minutes is chosen against the failure it prevents: a double-click is
 * sub-second, a browser retry is seconds, an impatient reload is tens of
 * seconds. Two minutes covers all of them with room to spare while staying far
 * below the point where a genuine "actually, write that again" would be denied
 * — and a generation takes longer than this window anyway, so the customer sees
 * the first draft already running before the window lapses.
 */
export const DEDUPE_WINDOW_MS = 120_000;

/**
 * Collapse the cosmetic differences between two spellings of one intent.
 *
 * Case, surrounding space and internal runs of whitespace are all noise here —
 * "  Best CRM  for Startups" and "best crm for startups" are one request typed
 * twice, and a key that distinguishes them protects nothing. Unicode is
 * normalised (NFKC) so a topic pasted from a rich-text editor matches the same
 * topic typed by hand, which matters for the CJK titles this product handles
 * routinely.
 */
export function normalizeTopic(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type DedupeInput = {
  userId: string;
  domainId: string;
  topic: string;
  /** When the request arrived. Injected so the bucketing is testable. */
  at?: Date;
  windowMs?: number;
};

/** Which bucket does `at` fall in? Exported for the boundary lookup below. */
function bucketOf(at: Date, windowMs: number): number {
  return Math.floor(at.getTime() / windowMs);
}

function keyForBucket(userId: string, domainId: string, topic: string, bucket: number): string {
  // Newline-joined rather than concatenated: a separator that cannot appear in
  // a normalised topic is what stops (user "ab", domain "c") from colliding
  // with (user "a", domain "bc").
  const material = [userId, domainId, normalizeTopic(topic), String(bucket)].join('\n');
  // 128 bits of SHA-256. Opaque on purpose — the key ends up in a database
  // column and must not invite anyone to parse a topic back out of it.
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

/** The key a request arriving now should be stored under. */
export function dedupeKeyFor(input: DedupeInput): string {
  const windowMs = input.windowMs ?? DEDUPE_WINDOW_MS;
  const at = input.at ?? new Date();
  return keyForBucket(input.userId, input.domainId, input.topic, bucketOf(at, windowMs));
}

/**
 * Keys to LOOK UP before inserting: this bucket and the previous one.
 *
 * Bucketing alone has a seam. Two clicks 200ms apart can land either side of a
 * bucket edge, hash differently, and both create a post — the exact bug this
 * module exists to prevent, made rare enough to be invisible in testing and
 * inevitable in production. Checking the previous bucket too means the window
 * is always at least `windowMs` wide no matter where in a bucket the first
 * request landed.
 *
 * Ordered current-first so the common case matches on the first comparison.
 */
export function dedupeKeyCandidates(input: DedupeInput): string[] {
  const windowMs = input.windowMs ?? DEDUPE_WINDOW_MS;
  const at = input.at ?? new Date();
  const b = bucketOf(at, windowMs);
  return [
    keyForBucket(input.userId, input.domainId, input.topic, b),
    keyForBucket(input.userId, input.domainId, input.topic, b - 1),
  ];
}

/** Postgres unique_violation — the other request won the insert race. */
export const UNIQUE_VIOLATION = '23505';

/** Postgres undefined_column — migration 0034 has not landed here yet. */
export const UNDEFINED_COLUMN = '42703';

/**
 * Is this error just "the column does not exist yet"?
 *
 * Deployment order is not guaranteed: a migration can reach production ahead of
 * the code that needs it, or behind it. Behind is the dangerous direction here —
 * an insert naming a column Postgres has never heard of fails outright, which
 * would turn a missing migration into "nobody can create a draft at all". The
 * caller retries without the key: worse idempotency for a few minutes beats an
 * outage, and it matches how lib/strategy/ensure handles `planned_by` (0029).
 */
export function isMissingColumn(err: { code?: string } | null | undefined): boolean {
  return err?.code === UNDEFINED_COLUMN;
}

/**
 * Did this insert lose a dedupe race (as opposed to failing for a real reason)?
 *
 * The distinction decides whether the caller returns the winner's post id and a
 * happy response, or surfaces an error. Getting it wrong in one direction shows
 * the customer a failure for a draft that is being written right now; in the
 * other it swallows a genuine insert failure.
 */
export function isDedupeCollision(err: { code?: string } | null | undefined): boolean {
  return err?.code === UNIQUE_VIOLATION;
}
