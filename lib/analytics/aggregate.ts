/**
 * Pure first-party analytics aggregation — no I/O, unit-tested.
 *
 * Turns raw post_events rows into the shapes the analytics dashboard renders:
 *   - traffic sources (Google Search / Answer engines / Direct / Social+referral)
 *   - answer-engine referrals (honest proxy for "AI citations": a click-through
 *     from ChatGPT/Perplexity/Claude/Gemini/Copilot — NOT impressions, and NOT
 *     Google AI Overviews, which referer-reports as plain google.com)
 *   - a 3-stage content funnel (clicks → read past 50% → converted), counted by
 *     distinct session so one engaged reader isn't double-counted.
 *
 * Mirrors lib/search-console/insights.ts: keep this file free of Supabase so it
 * stays trivially testable; the page/loader does the querying.
 */

export type EventRow = {
  type: string;                 // view | dwell | scroll | outbound | exit | conversion
  referrer_host: string | null; // normalized, e.g. 'google.com', 'chatgpt.com'
  utm_source: string | null;
  scroll_depth: number | null;  // 25 | 50 | 75 | 100
  session_id: string;
  dwell_ms?: number | null;     // cumulative time in tab, from dwell/exit beacons
};

export type SourceKey = 'search' | 'answer' | 'direct' | 'social';

/** Answer engines whose referrer is distinguishable from normal search.
 *  (Google AI Overviews is intentionally absent — it reports as google.com.) */
const ANSWER_HOSTS = [
  'chatgpt.com', 'chat.openai.com', 'openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com', 'bard.google.com',
  'copilot.microsoft.com',
  'you.com', 'phind.com', 'poe.com',
];
/** Friendly engine label for an answer-engine host. */
export function answerEngineName(host: string): string | null {
  const h = host.toLowerCase();
  if (h.includes('openai') || h.includes('chatgpt')) return 'ChatGPT';
  if (h.includes('perplexity')) return 'Perplexity';
  if (h.includes('claude')) return 'Claude';
  if (h.includes('gemini') || h.includes('bard')) return 'Gemini';
  if (h.includes('copilot')) return 'Copilot';
  if (h.includes('you.com')) return 'You.com';
  if (h.includes('phind')) return 'Phind';
  if (h.includes('poe')) return 'Poe';
  return null;
}

const SEARCH_HOSTS = [
  'google.', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'naver.com',
  'yandex.', 'baidu.com', 'ecosia.org', 'search.brave.com', 'startpage.com',
];
const SOCIAL_HOSTS = [
  't.co', 'x.com', 'twitter.com', 'facebook.com', 'fb.com', 'linkedin.com',
  'lnkd.in', 'reddit.com', 'instagram.com', 'youtube.com', 'youtu.be',
  'pinterest.com', 'news.ycombinator.com', 'tiktok.com', 'threads.net',
];

/** Classify a single referrer into one of the four dashboard buckets. */
export function classifySource(referrerHost: string | null, utmSource?: string | null): SourceKey {
  const host = (referrerHost ?? '').toLowerCase();
  if (!host) {
    // No referrer: respect an explicit utm_source if present, else Direct.
    const u = (utmSource ?? '').toLowerCase();
    if (!u) return 'direct';
    if (ANSWER_HOSTS.some((a) => u.includes(a.split('.')[0]))) return 'answer';
    if (['google', 'bing', 'duckduckgo', 'yahoo', 'naver'].some((s) => u.includes(s))) return 'search';
    if (['twitter', 'x', 'facebook', 'linkedin', 'reddit', 'instagram', 'youtube'].some((s) => u.includes(s))) return 'social';
    return 'social';
  }
  if (ANSWER_HOSTS.some((a) => host === a || host.endsWith('.' + a))) return 'answer';
  if (SEARCH_HOSTS.some((s) => (s.endsWith('.') ? host.startsWith(s) || host.includes('.' + s) : host === s || host.endsWith('.' + s)))) return 'search';
  if (SOCIAL_HOSTS.some((s) => host === s || host.endsWith('.' + s))) return 'social';
  return 'social'; // any other referring site → "Social + referral"
}

export type TrafficSource = { key: SourceKey; name: string; clicks: number; pct: number };

const SOURCE_LABEL: Record<SourceKey, string> = {
  search: 'Google Search',
  answer: 'Answer engines',
  direct: 'Direct',
  social: 'Social + referral',
};

/**
 * Pageview counts per source, as percentages. Counts `view` events (one per
 * page load). Returns the four buckets in a stable order with whole-number
 * percentages that sum to ~100.
 */
export function trafficSources(events: EventRow[]): { total: number; sources: TrafficSource[] } {
  const views = events.filter((e) => e.type === 'view');
  const counts: Record<SourceKey, number> = { search: 0, answer: 0, direct: 0, social: 0 };
  for (const v of views) counts[classifySource(v.referrer_host, v.utm_source)]++;
  const total = views.length;
  const order: SourceKey[] = ['search', 'answer', 'direct', 'social'];
  const sources = order.map((key) => ({
    key,
    name: SOURCE_LABEL[key],
    clicks: counts[key],
    pct: total > 0 ? Math.round((counts[key] / total) * 100) : 0,
  }));
  return { total, sources };
}

export type AnswerReferrals = {
  total: number;
  byEngine: { name: string; count: number; pct: number }[];
};

/** Real answer-engine click-throughs, broken down by engine. */
export function answerReferrals(events: EventRow[]): AnswerReferrals {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'view' || !e.referrer_host) continue;
    const name = answerEngineName(e.referrer_host);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const byEngine = [...counts.entries()]
    .map(([name, count]) => ({ name, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
  return { total, byEngine };
}

export type Funnel = {
  clicks: number;     // distinct sessions that loaded a post
  read50: number;     // distinct sessions that scrolled past 50%
  converted: number;  // distinct sessions that clicked the CTA (conversion event)
};

export type Engagement = {
  views: number;      // 'view' events (page loads)
  events: number;     // ALL first-party events, GA's "event count" equivalent
  sessions: number;   // distinct sessions
  avgDwellSec: number; // avg per-session time on page (max dwell seen per session)
};

/**
 * First-party engagement summary — the honest counterpart to GA's engagement
 * time + event count, over blog articles (the only pages the beacon runs on).
 * Dwell is cumulative and re-sent every 15s (plus a final exit beacon), so a
 * session's real time-on-page is the MAX dwell_ms it emitted; we average those.
 */
export function engagement(events: EventRow[]): Engagement {
  const perSession = new Map<string, number>(); // session_id → max dwell_ms
  const sessions = new Set<string>();
  let views = 0;
  for (const e of events) {
    if (e.session_id) sessions.add(e.session_id);
    if (e.type === 'view') views++;
    if ((e.type === 'dwell' || e.type === 'exit') && e.session_id) {
      const ms = Number.isFinite(e.dwell_ms as number) ? (e.dwell_ms as number) : 0;
      perSession.set(e.session_id, Math.max(perSession.get(e.session_id) ?? 0, ms));
    }
  }
  const dwellVals = [...perSession.values()];
  const avgMs = dwellVals.length ? dwellVals.reduce((a, b) => a + b, 0) / dwellVals.length : 0;
  return { views, events: events.length, sessions: sessions.size, avgDwellSec: avgMs / 1000 };
}

/** Three honest funnel stages, de-duplicated by session. */
export function funnel(events: EventRow[]): Funnel {
  const viewed = new Set<string>();
  const read = new Set<string>();
  const conv = new Set<string>();
  for (const e of events) {
    if (!e.session_id) continue;
    if (e.type === 'view') viewed.add(e.session_id);
    if (e.type === 'scroll' && (e.scroll_depth ?? 0) >= 50) read.add(e.session_id);
    if (e.type === 'conversion') conv.add(e.session_id);
  }
  return { clicks: viewed.size, read50: read.size, converted: conv.size };
}
