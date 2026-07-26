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

/** Compose the brief as a list of short sentences (joined by the UI). */
export function composeBrief(s: BriefStats): string[] {
  const out: string[] = [];

  // Nothing exists yet — onboarding voice.
  if (s.totalPublished === 0 && s.inFlight === 0 && s.inReview === 0) {
    return ['No articles yet. Queue a topic below and I get to work immediately — research, draft, quality check, publish.'];
  }
  if (s.totalPublished === 0) {
    if (s.inFlight > 0) out.push(`I'm drafting your first ${s.inFlight === 1 ? 'article' : `${s.inFlight} articles`} right now.`);
    if (s.inReview > 0) out.push(`${plural(s.inReview, 'draft')} ${s.inReview === 1 ? 'is' : 'are'} ready for your review.`);
    if (s.nextScheduledAt) out.push('First publish is scheduled — readers incoming.');
    return out;
  }

  // What I did.
  out.push(s.publishedThisWeek > 0
    ? `I published ${plural(s.publishedThisWeek, 'new article')} this week.`
    : 'No new articles went out this week.');

  // What happened.
  if (s.readsThisWeek > 0) {
    let delta = '';
    if (s.readsLastWeek > 0) {
      const pct = Math.round(((s.readsThisWeek - s.readsLastWeek) / s.readsLastWeek) * 100);
      if (pct >= 5) delta = ` — up ${pct}% on last week`;
      else if (pct <= -5) delta = ` — down ${Math.abs(pct)}% from last week`;
      else delta = ' — steady with last week';
    } else {
      delta = ' — your first readers';
    }
    out.push(`${plural(s.readsThisWeek, 'read')}${delta}.`);
    if (s.conversionsThisWeek > 0) {
      out.push(`${s.conversionsThisWeek} of them clicked through to ${s.hostname}.`);
    }
    if (s.organicShare >= 0.05) {
      out.push(`Search engines drove ${Math.round(s.organicShare * 100)}% of readers.`);
    }
    if (s.topPost) {
      out.push(`Best performer: “${s.topPost.title}” (${plural(s.topPost.views, 'read')}).`);
    }
  } else if (s.totalPublished > 0) {
    out.push('No reads recorded this week yet — search traffic usually takes a few weeks to compound after publishing.');
  }

  // What's next.
  if (s.inFlight > 0) out.push(`${plural(s.inFlight, 'article')} in the works.`);

  return out;
}

/** The one thing the owner should do next, if anything. */
export function nextAction(s: BriefStats): { label: string; href: string } | null {
  if (s.inReview > 0) {
    return { label: `Review ${plural(s.inReview, 'waiting draft')} →`, href: '/dashboard/pipeline' };
  }
  return null;
}
