/**
 * One answer to "how many posts are in what state" — for every surface.
 *
 * Five places used to compute this independently, and they disagreed:
 *
 *   - the nav badge (app/dashboard/layout) counted EVERY status except
 *     published/failed/archived, across ALL of the owner's domains
 *   - the header bell (lib/notifications/feed) counted review+failed for the
 *     active domain, over the last 25 posts
 *   - the dashboard home counted `review` for the active domain
 *   - the pipeline page grouped five ways over the last 40 posts
 *   - OverviewPipeline tabbed its own grouping
 *
 * With one site holding 1 post in review and another holding 15 queued, the
 * badge read "16" while the pipeline page for the site you were looking at said
 * "1 waiting on you". Neither was wrong on its own terms; together they were
 * incoherent, and the badge — the thing that draws the eye — was the least
 * meaningful of the five.
 *
 * The rule this encodes: a badge means "something needs YOU", scoped to the
 * site you are looking at. Work the agent is doing on its own is progress, not
 * a to-do, and belongs in the pipeline view rather than an alarm.
 */

/** Minimum shape any caller can supply — a posts row, or a slice of one. */
export type CountablePost = {
  status?: string | null;
  created_at?: string | null;
};

export type PipelineCounts = {
  /** Agent is actively working: queued, researching, writing (and not stuck). */
  inFlight: number;
  /** Finished drafts gated for human sign-off. */
  needsReview: number;
  scheduled: number;
  published: number;
  /** Outright failures PLUS runs stranded mid-flight. */
  failed: number;
  /**
   * The badge number: what the owner personally has to act on.
   * Deliberately excludes in-flight work — the agent is handling that.
   */
  needsYou: number;
};

/** Statuses that mean the agent currently has the post in hand. */
export const WORKING = ['queued', 'researching', 'writing'];

/**
 * Minutes in a working status before a run is treated as stranded rather than
 * active. Generation measures ~138s p80, so 3 minutes is comfortably past a
 * healthy run without flagging a merely slow one.
 */
export const STUCK_AFTER_MIN = 3;

export function isStuck(post: CountablePost, now = Date.now()): boolean {
  if (!WORKING.includes(post.status ?? '')) return false;
  if (!post.created_at) return false;
  const started = new Date(post.created_at).getTime();
  if (!Number.isFinite(started)) return false;
  return (now - started) / 60_000 > STUCK_AFTER_MIN;
}

export function pipelineCounts(
  posts: readonly CountablePost[] | null | undefined,
  now = Date.now(),
): PipelineCounts {
  const counts: PipelineCounts = {
    inFlight: 0, needsReview: 0, scheduled: 0, published: 0, failed: 0, needsYou: 0,
  };

  for (const p of posts ?? []) {
    const status = p.status ?? '';
    if (status === 'failed' || isStuck(p, now)) counts.failed++;
    else if (WORKING.includes(status)) counts.inFlight++;
    else if (status === 'review') counts.needsReview++;
    else if (status === 'scheduled') counts.scheduled++;
    else if (status === 'published') counts.published++;
    // anything else (archived, unknown future statuses) is intentionally
    // uncounted rather than swept into a bucket it doesn't belong in.
  }

  counts.needsYou = counts.needsReview + counts.failed;
  return counts;
}
