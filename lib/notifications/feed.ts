/**
 * Service activity feed — the "actual service" notifications (as opposed to the
 * one-time onboarding guide). Surfaces noteworthy pipeline events for the active
 * domain: an article started writing, a draft needs review, a post got scheduled
 * or published, or a run failed. Derived from the posts table the app already
 * maintains; best-effort and fail-soft.
 *
 * Surfaced by the header bell (app/dashboard/OnboardingBell.tsx) in a feed that
 * is visually distinct from the onboarding checklist.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityKind = 'writing' | 'review' | 'scheduled' | 'published' | 'failed';

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  /** Short status line, e.g. "Needs your review". */
  label: string;
  /** The post this is about. */
  postTitle: string;
  href: string;
  /** ISO timestamp this became noteworthy. */
  at: string;
};

export type Activity = {
  items: ActivityItem[];
  /** Items that want the user to act (review / failed). Drives the bell dot. */
  attentionCount: number;
};

type ActiveDomain = { id: string } | null;

export const EMPTY_ACTIVITY: Activity = { items: [], attentionCount: 0 };

const KIND_FOR: Record<string, { kind: ActivityKind; label: string; href: (id: string) => string }> = {
  queued:      { kind: 'writing',   label: 'Queued to write',   href: () => '/dashboard/pipeline' },
  researching: { kind: 'writing',   label: 'Researching',       href: () => '/dashboard/pipeline' },
  writing:     { kind: 'writing',   label: 'Writing in progress', href: () => '/dashboard/pipeline' },
  review:      { kind: 'review',    label: 'Needs your review', href: (id) => `/dashboard/posts/${id}` },
  scheduled:   { kind: 'scheduled', label: 'Scheduled to publish', href: () => '/dashboard/calendar' },
  published:   { kind: 'published', label: 'Published',         href: () => '/dashboard/published' },
  failed:      { kind: 'failed',    label: 'Failed — needs attention', href: () => '/dashboard/pipeline' },
};

export async function getActivity(sb: SupabaseClient, domain: ActiveDomain): Promise<Activity> {
  const id = domain?.id ?? null;
  if (!id) return EMPTY_ACTIVITY;

  let rows: any[] = [];
  try {
    const { data } = await sb
      .from('posts')
      .select('id, title, topic, status, scheduled_at, published_at, created_at')
      .eq('domain_id', id)
      .order('created_at', { ascending: false })
      .limit(25);
    rows = data ?? [];
  } catch {
    return EMPTY_ACTIVITY;
  }

  const items: ActivityItem[] = rows
    .map((p) => {
      const def = KIND_FOR[p.status as string];
      if (!def) return null;
      const at = p.published_at ?? p.scheduled_at ?? p.created_at;
      return {
        id: p.id,
        kind: def.kind,
        label: def.label,
        postTitle: p.title || p.topic || 'Untitled draft',
        href: def.href(p.id),
        at,
      } as ActivityItem;
    })
    .filter((x): x is ActivityItem => x !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  const attentionCount = items.filter((i) => i.kind === 'review' || i.kind === 'failed').length;
  return { items, attentionCount };
}
