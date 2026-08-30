/**
 * The agent's weekly brief — turns pipeline state + post_events into the
 * plain-English report a marketing hire would give you on Monday morning.
 *
 * Split in two so the words are unit-testable without a database:
 *   - getBriefStats()  → queries (admin client; caller must own the domain)
 *   - composeBrief()   → pure text from those numbers
 */
import { supabaseAdmin } from './supabase/admin';
import { summarizeMonth } from './strategy/review';
import { createT, type T } from './i18n';

export type BriefStats = {
  hostname: string;
  publishedThisWeek: number;
  totalPublished: number;
  readsThisWeek: number;
  readsLastWeek: number;
  conversionsThisWeek: number;
  organicShare: number;            // 0..1 of this week's sessions
  inReview: number;
  inFlight: number;                // queued / researching / writing
  nextScheduledAt: string | null;
  // `id` lets the dashboard find the post itself (its generation topic makes a
  // better cluster seed than the headline). Optional so the pure-text callers
  // and their fixtures don't have to carry it.
  topPost: { id?: string; title: string; views: number } | null;
};

export async function getBriefStats(domainId: string, hostname: string): Promise<BriefStats> {
  const sb = supabaseAdmin();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400_000);

  const count = async (apply: (q: any) => any): Promise<number> => {
    const q = sb.from('posts').select('id', { count: 'exact', head: true }).eq('domain_id', domainId);
    const { count: n } = await apply(q);
    return n ?? 0;
  };

  const [thisWeek, lastWeek, publishedThisWeek, totalPublished, inReview, inFlight, nextSched] =
    await Promise.all([
      summarizeMonth(domainId, weekAgo, now).catch(() => null),
      summarizeMonth(domainId, twoWeeksAgo, weekAgo).catch(() => null),
      count((q) => q.eq('status', 'published').gte('published_at', weekAgo.toISOString())),
      count((q) => q.eq('status', 'published')),
      count((q) => q.eq('status', 'review')),
      count((q) => q.in('status', ['queued', 'researching', 'writing'])),
      sb.from('posts').select('scheduled_at').eq('domain_id', domainId)
        .eq('status', 'scheduled').order('scheduled_at', { ascending: true })
        .limit(1).maybeSingle(),
    ]);

  const top = thisWeek?.top_posts?.[0] ?? null;
  return {
    hostname,
    publishedThisWeek,
    totalPublished,
    readsThisWeek: thisWeek?.totals.views ?? 0,
    readsLastWeek: lastWeek?.totals.views ?? 0,
    conversionsThisWeek: thisWeek?.totals.conversions ?? 0,
    organicShare: thisWeek?.totals.organic_share ?? 0,
    inReview,
    inFlight,
    nextScheduledAt: (nextSched as any)?.data?.scheduled_at ?? null,
    topPost: top && top.views > 0 ? { id: top.post_id, title: top.title, views: top.views } : null,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Compose the brief as a list of short sentences (joined by the UI).
 *
 * Every sentence goes through `t` with placeholders rather than string
 * concatenation, because the pieces do not survive translation: English
 * pluralises with -s and Korean does not pluralise at all, and "up 12% on last
 * week" attaches to a different part of the Korean sentence. So each variant
 * is one whole translatable sentence, and the counts are `{n}` inside it.
 */
export function composeBrief(s: BriefStats, t: T = createT('en')): string[] {
  const out: string[] = [];

  // Nothing exists yet — onboarding voice.
  if (s.totalPublished === 0 && s.inFlight === 0 && s.inReview === 0) {
    return [t('No articles yet. Queue a topic below and I get to work immediately — research, draft, quality check, publish.')];
  }
  if (s.totalPublished === 0) {
    if (s.inFlight > 0) {
      out.push(s.inFlight === 1
        ? t('I\'m drafting your first article right now.')
        : t('I\'m drafting your first {n} articles right now.', { n: s.inFlight }));
    }
    if (s.inReview > 0) {
      out.push(s.inReview === 1
        ? t('1 draft is ready for your review.')
        : t('{n} drafts are ready for your review.', { n: s.inReview }));
    }
    if (s.nextScheduledAt) out.push(t('First publish is scheduled — readers incoming.'));
    return out;
  }

  // What I did.
  out.push(s.publishedThisWeek > 0
    ? (s.publishedThisWeek === 1
      ? t('I published 1 new article this week.')
      : t('I published {n} new articles this week.', { n: s.publishedThisWeek }))
    : t('No new articles went out this week.'));

  // What happened. The whole sentence is one key per trend, so a translation
  // can put the comparison wherever its grammar wants it.
  if (s.readsThisWeek > 0) {
    const n = s.readsThisWeek;
    if (s.readsLastWeek > 0) {
      const pct = Math.round(((n - s.readsLastWeek) / s.readsLastWeek) * 100);
      if (pct >= 5) out.push(t('{n} reads — up {pct}% on last week.', { n, pct }));
      else if (pct <= -5) out.push(t('{n} reads — down {pct}% from last week.', { n, pct: Math.abs(pct) }));
      else out.push(t('{n} reads — steady with last week.', { n }));
    } else {
      out.push(t('{n} reads — your first readers.', { n }));
    }
    if (s.conversionsThisWeek > 0) {
      out.push(t('{n} of them clicked through to {host}.', { n: s.conversionsThisWeek, host: s.hostname }));
    }
    if (s.organicShare >= 0.05) {
      out.push(t('Search engines drove {pct}% of readers.', { pct: Math.round(s.organicShare * 100) }));
    }
    if (s.topPost) {
      out.push(t('Best performer: “{title}” ({n} reads).', { title: s.topPost.title, n: s.topPost.views }));
    }
  } else if (s.totalPublished > 0) {
    out.push(t('No reads recorded this week yet — search traffic usually takes a few weeks to compound after publishing.'));
  }

  // What's next.
  if (s.inFlight > 0) {
    out.push(s.inFlight === 1
      ? t('1 article in the works.')
      : t('{n} articles in the works.', { n: s.inFlight }));
  }

  return out;
}

/** The one thing the owner should do next, if anything. */
export function nextAction(s: BriefStats, t: T = createT('en')): { label: string; href: string } | null {
  if (s.inReview > 0) {
    return {
      label: s.inReview === 1
        ? t('Review 1 waiting draft →')
        : t('Review {n} waiting drafts →', { n: s.inReview }),
      href: '/dashboard/pipeline',
    };
  }
  return null;
}
