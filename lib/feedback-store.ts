/**
 * SERVER-ONLY reads over the `feedback` table (migration 0034).
 *
 * Split from lib/feedback.ts on purpose: that file is the vocabulary and is
 * imported by client components, so it must stay free of the service-role
 * client. This one holds the queries and never reaches a browser bundle.
 *
 * Every function here is best-effort by design — it returns an empty/zero
 * result rather than throwing. All of them feed decoration (a nav badge, an
 * admin card, a marketing section), and none is worth 500-ing a page over,
 * least of all before migration 0034 has been applied.
 */
import { supabaseAdmin } from './supabase/admin';
import { toTestimonial, triageRank, type Testimonial } from './feedback';

/** Statuses the owner still owes something on. Mirrors lib/feedback isOpen. */
const OPEN = ['new', 'acknowledged', 'in_progress'];

export type FeedbackRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  kind: string;
  rating: number | null;
  headline: string | null;
  body: string;
  area: string | null;
  severity: string | null;
  consent_publish: boolean;
  display_name: string | null;
  display_role: string | null;
  display_url: string | null;
  published: boolean;
  status: string;
  owner_note: string | null;
  responded_at: string | null;
  responded_by: string | null;
  plan: string | null;
  beta_code: string | null;
  posts_published: number | null;
  page_url: string | null;
  created_at: string;
};

/** How many pieces of feedback still need the owner. Drives the nav badge. */
export async function openFeedbackCount(): Promise<number> {
  try {
    const { count } = await supabaseAdmin()
      .from('feedback')
      .select('id', { count: 'exact', head: true })
      .in('status', OPEN);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The owner's inbox.
 *
 * Fetched newest-first in SQL, then re-sorted in memory by `triageRank` so a
 * blocking complaint from Tuesday outranks a testimonial from this morning.
 * Doing the ordering here rather than in SQL keeps the priority rule in one
 * testable place (lib/feedback) instead of encoding it in an ORDER BY that
 * nothing can unit-test.
 */
export async function listFeedback(opts: { limit?: number; kind?: string; openOnly?: boolean } = {}): Promise<FeedbackRow[]> {
  const limit = opts.limit ?? 100;
  try {
    let q = supabaseAdmin()
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (opts.kind) q = q.eq('kind', opts.kind);
    if (opts.openOnly) q = q.in('status', OPEN);
    const { data } = await q;
    const rows = (data ?? []) as FeedbackRow[];
    return rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => triageRank(a.r) - triageRank(b.r) || a.i - b.i)
      .map(({ r }) => r);
  } catch {
    return [];
  }
}

export type FeedbackStats = {
  open: number;
  total: number;
  complaintsOpen: number;
  blockers: number;
  testimonials: number;
  publishable: number;
  published: number;
  /** Mean of every rating given, or null when nobody has rated yet. */
  avgRating: number | null;
};

export const EMPTY_FEEDBACK_STATS: FeedbackStats = {
  open: 0, total: 0, complaintsOpen: 0, blockers: 0,
  testimonials: 0, publishable: 0, published: 0, avgRating: null,
};

/** Counters for the admin overview. One query, tallied in memory. */
export async function feedbackStats(): Promise<FeedbackStats> {
  try {
    const { data } = await supabaseAdmin()
      .from('feedback')
      .select('kind, status, severity, rating, consent_publish, published');
    const rows = (data ?? []) as Pick<
      FeedbackRow, 'kind' | 'status' | 'severity' | 'rating' | 'consent_publish' | 'published'
    >[];

    const out = { ...EMPTY_FEEDBACK_STATS, total: rows.length };
    let ratingSum = 0;
    let ratingCount = 0;
    for (const r of rows) {
      const open = OPEN.includes(r.status);
      if (open) out.open++;
      if (r.kind === 'complaint' && open) out.complaintsOpen++;
      if (r.kind === 'complaint' && open && r.severity === 'blocker') out.blockers++;
      if (r.kind === 'testimonial') {
        out.testimonials++;
        // "Publishable" is consented-but-not-yet-published: the queue of
        // marketing copy already sitting there, which is the number the owner
        // actually acts on.
        if (r.consent_publish && !r.published) out.publishable++;
        if (r.published) out.published++;
      }
      if (typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5) {
        ratingSum += r.rating;
        ratingCount++;
      }
    }
    out.avgRating = ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : null;
    return out;
  } catch {
    return EMPTY_FEEDBACK_STATS;
  }
}

/**
 * Testimonials cleared for public display.
 *
 * Both conditions are required, not just `published`: consent is what the
 * customer gave and `published` is what the owner did, and a row that somehow
 * lost consent after being published must drop off the site immediately rather
 * than wait for someone to notice. The API enforces the same pair on the way
 * in; this is the second lock, on the way out.
 */
export async function publishedTestimonials(limit = 6): Promise<Testimonial[]> {
  try {
    const { data } = await supabaseAdmin()
      .from('feedback')
      .select('body, headline, rating, display_name, display_role, display_url')
      .eq('kind', 'testimonial')
      .eq('published', true)
      .eq('consent_publish', true)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []).map(toTestimonial).filter((t) => t.quote.trim().length > 0);
  } catch {
    return [];
  }
}
