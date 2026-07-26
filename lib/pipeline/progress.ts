/**
 * Where one draft is in the pipeline, in the customer's words.
 *
 * The dashboard reads a post's stage straight off `status` + `generation_log`
 * in three places already (PostRow, PipelineTimeline, the post page). This is
 * the shared, testable version, written for the surface that has to answer
 * "is my article ready yet?" while the author waits on it — the Write page's
 * queued card polls `GET /api/posts/[id]` for exactly this shape.
 */
import { isStranded, type LogLike } from './capacity';

export type DraftPhase = 'queued' | 'working' | 'ready' | 'scheduled' | 'live' | 'failed';

export type DraftProgress = {
  phase: DraftPhase;
  /** One present-tense line for the author. Never jargon, never a step id. */
  label: string;
  /** The run stopped making progress — the platform killed it mid-article. */
  stalled: boolean;
  /** There are words to open in the editor. */
  hasDraft: boolean;
};

/** Statuses that mean a generation is (or should be) running right now. */
const IN_FLIGHT = new Set(['queued', 'researching', 'writing']);

/**
 * How long a silent log is tolerated before we tell the author it's overdue.
 * Deliberately far shorter than `STALE_GENERATION_MS` (30m, the point at which
 * the scheduler actually reclaims the post): this threshold only changes what
 * we SAY, and a spinner that has been lying for half an hour is worse than an
 * honest "this is taking longer than usual".
 */
export const STALL_HINT_MS = 5 * 60_000;

/** Present-tense label per pipeline step, for a step that has started. */
const STEP_LABELS: Record<string, string> = {
  queued: 'Queued in the pipeline…',
  site_profile: 'Reading your site…',
  research: 'Searching the web…',
  topic_refiner: 'Picking the angle…',
  writer: 'Writing the article…',
  manager: 'Running the quality check…',
  persist: 'Saving the draft…',
  cover_image: 'Making a cover image…',
  inline_images: 'Adding images…',
  social: 'Preparing the social posts…',
};

type PostLike = {
  status?: string | null;
  generation_log?: LogLike;
  body_md?: string | null;
};

export function draftProgress(post: PostLike, nowMs: number = Date.now()): DraftProgress {
  const status = post?.status ?? '';
  const hasDraft = (post?.body_md ?? '').trim().length > 0;

  if (status === 'failed') {
    return { phase: 'failed', label: 'Generation failed.', stalled: false, hasDraft };
  }
  if (status === 'published') {
    return { phase: 'live', label: 'Published.', stalled: false, hasDraft };
  }
  if (status === 'scheduled') {
    return { phase: 'scheduled', label: 'Scheduled to publish.', stalled: false, hasDraft };
  }

  if (IN_FLIGHT.has(status)) {
    const stalled = isStranded(post?.generation_log, nowMs, STALL_HINT_MS);
    if (stalled) {
      return {
        phase: 'working',
        // True either way: a killed run is put back in the queue by the
        // scheduler's reclaim, and a queued post leads the next drain.
        label: 'Taking longer than usual — grove will finish it on the next run.',
        stalled: true,
        hasDraft,
      };
    }
    return { phase: status === 'queued' ? 'queued' : 'working', label: currentLabel(post?.generation_log), stalled: false, hasDraft };
  }

  // Anything else (review, or a status we don't model) is the pipeline's end:
  // the author owns it now.
  return {
    phase: 'ready',
    label: hasDraft ? 'Your draft is ready.' : 'Held for your review.',
    stalled: false,
    hasDraft,
  };
}

/**
 * The newest step that started and hasn't finished. Falling back to the last
 * entry's step (rather than a generic "working") keeps the label moving through
 * the run even when a step logs `done` a beat before the next one starts.
 */
function currentLabel(log: LogLike): string {
  const entries = (log ?? []).filter((e): e is { ts?: number; step?: string } => !!e);
  const last = entries[entries.length - 1];
  const step = last?.step ?? 'queued';
  return STEP_LABELS[step] ?? STEP_LABELS.queued;
}
