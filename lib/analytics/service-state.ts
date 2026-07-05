/**
 * Service state — one honest answer to "is Grove actually running for this
 * domain right now?", shared by the analytics dashboard (status strip) and the
 * agent (plain-language lines prepended to its chat context).
 *
 * Four subsystems, each with a traffic-light level:
 *   - content engine  (posts pipeline: live / drafting / awaiting review)
 *   - search console  (OAuth → property verify → daily sync freshness)
 *   - reader tracking (are first-party events flowing from the blog/embed?)
 *   - quality gate    (recent manager scores)
 *
 * Pure — reads only its inputs — so the words are unit-testable without a DB.
 * Querying lives in lib/analytics/dashboard.ts (loadServiceState).
 */

export type StateLevel = 'ok' | 'attention' | 'off';

export type StateItem = {
  key: 'pipeline' | 'gsc' | 'tracking' | 'quality';
  label: string;
  level: StateLevel;
  value: string;    // short headline, e.g. "12 live"
  detail: string;   // one plain sentence of context
};

export type ServiceState = {
  items: StateItem[];
  lines: string[];  // compact sentences for agent prompts / briefs
};

export type ServiceStateInput = {
  now: Date;
  posts: {
    published: number;
    inFlight: number;          // queued / researching / writing
    inReview: number;
    scheduled: number;
    failed: number;
    nextScheduledAt: string | null;
    lastPublishedAt: string | null;
  };
  gsc: {
    configured: boolean;       // server has Google OAuth creds at all
    connected: boolean;        // owner completed OAuth
    verified: boolean;         // a property is wired up (gsc_site_url)
    syncedAt: string | null;
  };
  tracking: {
    lastEventAt: string | null;
    events7d: number;
  };
  quality: {
    avgScore: number | null;   // mean manager overall, recent evals
    evaluated: number;         // how many evals the average covers
  };
};

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** "3 hr ago" / "2 d ago" / "just now" — matches the dashboard's voice. */
export function relAgo(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now.getTime() - t);
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} min ago`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} hr ago`;
  return `${Math.round(ms / DAY)} d ago`;
}

/** "in 2 d" / "in 3 hr" for the next scheduled publish. */
function relIn(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const ms = t - now.getTime();
  if (ms <= 0) return 'today';
  if (ms < DAY) return `in ${Math.max(1, Math.round(ms / HOUR))} hr`;
  return `in ${Math.round(ms / DAY)} d`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function pipelineItem(p: ServiceStateInput['posts'], now: Date): StateItem {
  const bits: string[] = [];
  if (p.inFlight > 0) bits.push(`${p.inFlight} drafting`);
  if (p.inReview > 0) bits.push(`${p.inReview} awaiting your review`);
  const next = relIn(p.nextScheduledAt, now);
  if (next) bits.push(`next publish ${next}`);
  if (!bits.length && p.lastPublishedAt) bits.push(`last published ${relAgo(p.lastPublishedAt, now)}`);
  if (p.failed > 0) bits.push(`${p.failed} failed`);

  if (p.published + p.inFlight + p.inReview + p.scheduled === 0) {
    return { key: 'pipeline', label: 'Content engine', level: 'off', value: 'Idle', detail: 'No articles yet — queue a topic to start the pipeline' };
  }
  const level: StateLevel = p.inReview > 0 || p.failed > 0 ? 'attention' : 'ok';
  return {
    key: 'pipeline', label: 'Content engine', level,
    value: `${p.published} live`,
    detail: bits.join(' · ') || 'Publishing on schedule',
  };
}

function gscItem(g: ServiceStateInput['gsc'], now: Date): StateItem {
  const base = { key: 'gsc' as const, label: 'Search Console' };
  if (!g.configured) {
    return { ...base, level: 'off', value: 'Unavailable', detail: 'Google connection isn’t configured on this deployment' };
  }
  if (!g.connected) {
    return { ...base, level: 'off', value: 'Not connected', detail: 'Connect Google to pull clicks, impressions and rankings' };
  }
  if (!g.verified) {
    return { ...base, level: 'attention', value: 'Setup incomplete', detail: 'Google is connected — finish verifying the property to start syncing' };
  }
  if (!g.syncedAt) {
    return { ...base, level: 'attention', value: 'Awaiting first sync', detail: 'Verified — search data lands after the next daily sync' };
  }
  const ago = relAgo(g.syncedAt, now)!;
  const stale = now.getTime() - new Date(g.syncedAt).getTime() > 48 * HOUR;
  return stale
    ? { ...base, level: 'attention', value: 'Sync stale', detail: `Last synced ${ago} — data below may lag` }
    : { ...base, level: 'ok', value: 'Syncing', detail: `Last synced ${ago}` };
}

function trackingItem(t: ServiceStateInput['tracking'], published: number, now: Date): StateItem {
  const base = { key: 'tracking' as const, label: 'Reader tracking' };
  if (!t.lastEventAt) {
    return published > 0
      ? { ...base, level: 'attention', value: 'No events yet', detail: 'Posts are live but no reader events have arrived — check the blog embed' }
      : { ...base, level: 'off', value: 'Waiting', detail: 'Starts counting readers when your first post goes live' };
  }
  if (t.events7d === 0) {
    return { ...base, level: 'attention', value: 'Quiet', detail: `No reader events this week — last one ${relAgo(t.lastEventAt, now)}` };
  }
  return { ...base, level: 'ok', value: 'Active', detail: `${plural(t.events7d, 'reader event')} in the past 7 days` };
}

function qualityItem(q: ServiceStateInput['quality']): StateItem {
  const base = { key: 'quality' as const, label: 'Quality gate' };
  if (q.avgScore == null || q.evaluated === 0) {
    return { ...base, level: 'off', value: 'No scores yet', detail: 'Drafts are scored 0–100 by the manager before publishing' };
  }
  const score = Math.round(q.avgScore);
  const level: StateLevel = score >= 70 ? 'ok' : 'attention';
  return {
    ...base, level,
    value: `${score}/100 avg`,
    detail: `Across the last ${plural(q.evaluated, 'reviewed draft')}${score >= 70 ? '' : ' — below the 70 quality bar'}`,
  };
}

export function buildServiceState(input: ServiceStateInput): ServiceState {
  const items = [
    pipelineItem(input.posts, input.now),
    gscItem(input.gsc, input.now),
    trackingItem(input.tracking, input.posts.published, input.now),
    qualityItem(input.quality),
  ];
  const lines = items.map((i) => `${i.label}: ${i.value} — ${i.detail}.`);
  return { items, lines };
}

/** Compact block for agent prompts — current operational state in ~4 lines. */
export function serviceStateMd(state: ServiceState): string {
  return ['CURRENT SERVICE STATE', ...state.lines.map((l) => `- ${l}`)].join('\n');
}
