/**
 * Onboarding "what to do next" guide — computes the user's real progress through
 * the eight first-run steps, scoped to the active domain. Every signal is read
 * from data the app already produces (no separate progress table), and every
 * query is best-effort: any failure leaves that step `done: false` rather than
 * blocking the dashboard chrome from rendering.
 *
 * Surfaced by the header bell (app/dashboard/OnboardingBell.tsx).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type OnbStep = {
  id: string;
  n: number;
  title: string;
  desc: string;
  href: string;
  done: boolean;
  /** Bonus step that doesn't gate "you're all set" (e.g. social auto-post). */
  optional?: boolean;
};

export type Onboarding = {
  steps: OnbStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** First not-yet-done step — what to do next (null once everything's done). */
  nextN: number | null;
  nextHref: string | null;
};

/** The active domain shape the dashboard layout already has on hand. */
type ActiveDomain = { id: string; verified_at?: string | null } | null;

/** Count rows for a query without pulling them; returns 0 on any error. */
async function countRows(q: any): Promise<number> {
  try {
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function getOnboarding(sb: SupabaseClient, domain: ActiveDomain): Promise<Onboarding> {
  const id = domain?.id ?? null;

  // 1 · Domain verified — straight off the active domain row.
  const verified = !!domain?.verified_at;

  // Fire the independent existence checks together. Each is head-only (no rows).
  const [
    hasStrategy,
    postCount,
    draftedCount,
    approvedCount,
    eventCount,
    gscCount,
    socialCount,
  ] = id
    ? await Promise.all([
        // 2 · Strategy intent — an active strategy with a non-empty publishing plan.
        countRows(
          sb.from('strategies').select('id', { count: 'exact', head: true })
            .eq('domain_id', id).eq('active', true)
            .not('publishing_plan', 'eq', '[]'),
        ),
        // 4 · A topic has been queued — any post exists for the domain.
        countRows(sb.from('posts').select('id', { count: 'exact', head: true }).eq('domain_id', id)),
        // 5 · Autopilot wrote a draft — a post reached review/scheduled/published.
        countRows(
          sb.from('posts').select('id', { count: 'exact', head: true })
            .eq('domain_id', id).in('status', ['review', 'scheduled', 'published']),
        ),
        // 6 · Reviewed/approved — a post is scheduled or published.
        countRows(
          sb.from('posts').select('id', { count: 'exact', head: true })
            .eq('domain_id', id).in('status', ['scheduled', 'published']),
        ),
        // 3 · Embed live — any first-party view event means the script is rendering.
        countRows(sb.from('post_events').select('id', { count: 'exact', head: true }).eq('domain_id', id)),
        // 7a · Analytics — Search Console snapshot rows exist for the domain.
        countRows(sb.from('gsc_metrics').select('domain_id', { count: 'exact', head: true }).eq('domain_id', id)),
        // 8 · Social connected — a connection exists for the domain.
        countRows(sb.from('social_connections').select('id', { count: 'exact', head: true }).eq('domain_id', id)),
      ])
    : [0, 0, 0, 0, 0, 0, 0];

  const steps: OnbStep[] = [
    {
      id: 'verify_domain', n: 1,
      title: 'Verify your domain',
      desc: 'Add the DNS record so grove can publish to your site.',
      href: '/onboarding/verify',
      done: verified,
    },
    {
      id: 'strategy', n: 2,
      title: 'Set your strategy intent',
      desc: 'Tell grove your goals — it plans the content calendar.',
      href: '/dashboard/strategy',
      done: hasStrategy > 0,
    },
    {
      id: 'embed', n: 3,
      title: 'Embed on your site',
      desc: 'Drop the one-line script so the blog renders on your domain.',
      href: '/dashboard/embed',
      done: eventCount > 0,
    },
    {
      id: 'queue_topic', n: 4,
      title: 'Queue your first topic',
      desc: 'Add a keyword and let the pipeline take it from there.',
      href: '/dashboard/write',
      done: postCount > 0,
    },
    {
      id: 'autopilot_draft', n: 5,
      title: 'Watch autopilot write it',
      desc: 'The agent researches, drafts and edits — follow it in the pipeline.',
      href: '/dashboard/pipeline',
      done: draftedCount > 0,
    },
    {
      id: 'review_post', n: 6,
      title: 'Review the scheduled post',
      desc: 'Approve or tweak the draft before it goes live.',
      href: '/dashboard/reviews',
      done: approvedCount > 0,
    },
    {
      id: 'analytics', n: 7,
      title: 'See the results',
      desc: 'Track clicks and impressions as posts start ranking.',
      href: '/dashboard/analytics',
      done: gscCount > 0 || eventCount > 0,
    },
    {
      id: 'social', n: 8,
      title: 'Link a social account',
      desc: 'Auto-post every article to X, LinkedIn or Instagram.',
      href: '/dashboard/connections',
      done: socialCount > 0,
      optional: true,
    },
  ];

  // "All set" (and the header bell's alert dot) is gated on the *required* steps
  // only — optional bonuses like social auto-post never keep the dot nagging once
  // the core setup is finished.
  const required = steps.filter((s) => !s.optional);
  const next = required.find((s) => !s.done) ?? null;

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    complete: required.every((s) => s.done),
    nextN: next?.n ?? null,
    nextHref: next?.href ?? null,
  };
}

/** Safe empty default for contexts that render before onboarding is computed. */
export const EMPTY_ONBOARDING: Onboarding = {
  steps: [], doneCount: 0, total: 8, complete: false, nextN: null, nextHref: null,
};
