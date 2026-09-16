/**
 * The six steps grove goes through to turn a domain into a keyword-led
 * publishing plan, as a model the dashboard can DRAW.
 *
 *   1. business    — read the site: what it sells, to whom, what's different
 *   2. customers   — the reader: segments, pains, their own words (icp.ts)
 *   3. brainstorm  — the phrases those readers would actually type
 *   4. score       — keep the phrases worth chasing: volume vs. difficulty
 *   5. cluster     — group the keepers so one article captures a whole topic
 *   6. schedule    — one article per cluster, drafted, gated, published
 *
 * Why this exists: the strategy page showed the OUTPUT of the plan (pillars,
 * calendar, OKRs) and nothing about how it got there, and the feedback was
 * "I don't know what's going on or what I'm supposed to do". Both answers are
 * derived here from state the app already holds — the site profile, the
 * interview, the active strategy with the customer profile it was built for,
 * the keyword ledger (keyword_candidates, 0041) and the posts — so the tracker
 * can never disagree with the page below it. Nothing here calls the network.
 *
 * Every string a reader sees is rendered by the component; this file returns
 * keys and data only, so it can be unit-tested without a locale.
 */
import type { SiteProfile } from '../pipeline/site-profile';
import type { InterviewAnswers } from './interview';
import type { Strategy, PostSlot } from './build';
import { searchSeeds } from './seeds';
import { icpSeeds, buyerIntentSeeds, icpIsUsable, type CustomerProfile } from './icp';
import { classifyIntent, type SearchIntent } from './keywords';
import { opportunityScore, DEFAULT_KD_CEILING } from '../keywords/opportunity';
import type { LangCode } from '../language';
import { AUTO_REBUILD_REASONS, type StaleReason } from './freshness';

export type StepKey = 'business' | 'customers' | 'brainstorm' | 'score' | 'cluster' | 'schedule';
export const STEP_KEYS: readonly StepKey[] = ['business', 'customers', 'brainstorm', 'score', 'cluster', 'schedule'] as const;

/**
 * done      — finished; its artifact is on file.
 * active    — grove is working on it right now (or, for step 6, all month).
 * needs_you — blocked on something only the owner can do.
 * pending   — not reached yet.
 */
export type StepState = 'done' | 'active' | 'needs_you' | 'pending';

export type BusinessFacts = {
  kind: 'business';
  name: string;
  industry: string;
  description: string;
  products: string[];
  valueProps: string[];
  geography: string;
  pagesCrawled: number;
};

export type CustomersFacts = {
  kind: 'customers';
  /** What the crawl inferred about the reader, in the seller's words. */
  inferred: string;
  /** The owner's own pick(s) — interview `audience_focus`, stored in English. */
  chosen: string[];
  goal: string | null;
  kpi: string | null;
  /** One line per pillar: who it is written for. */
  personas: { pillar: string; audience: string }[];
  /** Step 2 proper — the profile the strategist inferred and planned for. */
  icp: {
    segments: { name: string; situation: string }[];
    pains: string[];
    triggers: string[];
    vocabulary: string[];
    objections: string[];
  } | null;
};

export type BrainstormFacts = {
  kind: 'brainstorm';
  /** The head terms the research expands from — the customer's words when
   *  a profile exists, the site's products otherwise (build.ts, step 3). */
  seeds: string[];
  language: LangCode;
  /** Every phrase the research has turned up for this domain, and where from. */
  considered: number;
  bySource: { source: string; n: number }[];
  /** The most-searched of them — volume descending, unmeasured last. */
  phrases: { keyword: string; volume: number | null; source: string }[];
};

export type KeywordRow = {
  keyword: string;
  intent: SearchIntent;
  /** The article it was chosen for. */
  topic: string;
  pillarId: string;
  /** Monthly searches, when the ledger measured it. */
  volume: number | null;
  /** Keyword difficulty 0–100, same condition. */
  kd: number | null;
  /** Estimated monthly impressions: volume × the chance this site ranks
   *  (lib/keywords/opportunity). Null when unmeasured. */
  score: number | null;
  source: string | null;
  /** Secondary phrases the same article also targets. */
  secondary: number;
};

export type ScoreFacts = {
  kind: 'score';
  keywords: KeywordRow[];
  /** True when at least one kept keyword carries volume or difficulty. */
  scored: boolean;
  /** Phrases on the ledger for this domain — what the keepers were picked from. */
  considered: number;
  /** The KD a site of this age is planned against. */
  ceiling: number;
};

export type ClusterCard = {
  id: string;
  pillarId: string;
  /** Article mode: the target keyword. Pillar mode: the pillar's title. */
  title: string;
  /** Article mode: the article's topic. Pillar mode: the pillar's promise. */
  promise: string;
  /** Article mode: the secondary phrases. Pillar mode: the pillar's targets. */
  keywords: { keyword: string; volume: number | null }[];
  slots: number;
  intent: PostSlot['intent'];
  kd: number | null;
  /** Σ volume across the cluster — the size of the prize one article can reach. */
  total: number | null;
};

export type ClusterFacts = {
  kind: 'cluster';
  /** `article` once slots carry secondary keywords (plans built from measured
   *  demand); `pillar` for plans from before clustering existed. */
  mode: 'article' | 'pillar';
  clusters: ClusterCard[];
};

export type ScheduleFacts = {
  kind: 'schedule';
  total: number;
  published: number;
  scheduled: number;
  drafting: number;
  review: number;
  /** ISO instant of the next article due, if any. */
  next: string | null;
  /** The execution tools and how often each has run for this site. */
  runs: { research: number; drafts: number; reviews: number };
};

export type StepFacts = BusinessFacts | CustomersFacts | BrainstormFacts | ScoreFacts | ClusterFacts | ScheduleFacts;

export type Step = { key: StepKey; n: number; state: StepState; facts: StepFacts | null };

/** What the owner should do now — one thing, or nothing. */
export type NextAction =
  | { kind: 'verify' }
  | { kind: 'interview' }
  | { kind: 'build' }
  /** `reason` is why, so the copy can say "the month is over" rather than
   *  guessing — a plan built before the keyword research landed is equally a
   *  rebuild, and telling the owner it's last month's plan would be false. */
  | { kind: 'rebuild'; reason: StaleReason }
  /** The plan and `domains.language` disagree. Deliberately NOT a rebuild:
   *  which half is wrong is the owner's call (see lib/strategy/freshness). */
  | { kind: 'relanguage' }
  | { kind: 'review'; count: number }
  | { kind: 'wait'; next: string | null };

export type StepsModel = {
  steps: Step[];
  /** The step the tracker highlights — the first one not finished. */
  current: StepKey;
  action: NextAction;
};

export type StepsPost = {
  status: string;
  slot_id?: string | null;
  topic?: string | null;
  scheduled_at?: string | null;
};

/** A keyword_candidates row, as much of it as the tracker reads. */
export type StepsCandidate = {
  keyword: string;
  source: string;
  volume: number | null;
  difficulty: number | null;
  intent: string | null;
  status: string;
};

export type StepsInput = {
  profile: SiteProfile | null | undefined;
  interview: InterviewAnswers | null | undefined;
  verified: boolean;
  strategy: (Strategy & { customer_profile?: CustomerProfile | null }) | null | undefined;
  posts: StepsPost[];
  /** The keyword ledger for this domain (keyword_candidates). */
  candidates?: StepsCandidate[];
  lang: LangCode;
  /**
   * Everything out of date about the live plan (lib/strategy/freshness).
   *
   * Was a bare `stale` boolean meaning only "the month has ended". A plan can
   * also be current-month and still not be the plan grove would build today —
   * the one from before the keyword ledger existed is the case that produced
   * "strategy only works on 1 domain" — and the tracker has to tell the owner
   * WHICH, because "last month's plan" is simply untrue of the second kind.
   */
  staleReasons?: StaleReason[];
  now?: Date;
};

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const norm = (s: string) => s.trim().toLowerCase();

/** An interview counts once any question has an answer. */
export function interviewAnswered(answers: InterviewAnswers | null | undefined): boolean {
  if (!answers) return false;
  return Object.values(answers).some((v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== ''));
}

function businessFacts(profile: SiteProfile): BusinessFacts {
  const b = profile.business;
  return {
    kind: 'business',
    name: b.name,
    industry: b.industry ?? '',
    description: b.description ?? '',
    products: asList(b.products_services).slice(0, 6),
    valueProps: asList(b.value_props).slice(0, 4),
    geography: b.geography ?? '',
    pagesCrawled: profile.meta?.pages_crawled?.length ?? 0,
  };
}

function customersFacts(
  profile: SiteProfile | null | undefined,
  interview: InterviewAnswers | null | undefined,
  strategy: StepsInput['strategy'],
  icp: CustomerProfile | null,
): CustomersFacts {
  return {
    kind: 'customers',
    inferred: profile?.business?.target_audience ?? '',
    chosen: asList(interview?.audience_focus),
    goal: asText(interview?.primary_goal),
    kpi: asText(interview?.primary_kpi),
    personas: (strategy?.pillars ?? [])
      .filter((p) => p.audience)
      .slice(0, 4)
      .map((p) => ({ pillar: p.title, audience: p.audience })),
    icp: icp
      ? {
          segments: icp.segments.slice(0, 4),
          pains: icp.pains.slice(0, 6),
          triggers: icp.triggers.slice(0, 4),
          vocabulary: icp.vocabulary.slice(0, 12),
          objections: icp.objections.slice(0, 4),
        }
      : null,
  };
}

/** The ledger keyed by lowercase phrase, for the joins below. */
function ledger(candidates: StepsCandidate[]): Map<string, StepsCandidate> {
  const m = new Map<string, StepsCandidate>();
  for (const c of candidates) {
    const k = norm(c.keyword);
    if (k && !m.has(k)) m.set(k, c);
  }
  return m;
}

const byVolume = (a: { volume: number | null }, b: { volume: number | null }) => {
  if (a.volume == null && b.volume == null) return 0;
  if (a.volume == null) return 1;
  if (b.volume == null) return -1;
  return b.volume - a.volume;
};

function brainstormFacts(
  profile: SiteProfile | null | undefined,
  icp: CustomerProfile | null,
  candidates: StepsCandidate[],
  lang: LangCode,
): BrainstormFacts {
  // The same precedence build.ts uses: the customer's vocabulary when a
  // profile exists, the site's own products otherwise — plus the buyer's
  // seeds (competitor alternatives, workarounds, use cases). What the build
  // took from Search Console is not re-derived here: it needs the snapshot,
  // and this panel is meant to stay a pure read of what is already stored.
  const brand = profile?.business?.name;
  const seeds = [...new Set([
    ...(icpIsUsable(icp) ? icpSeeds(icp, { limit: 8, brand }) : searchSeeds(profile, { limit: 8 })),
    ...buyerIntentSeeds(icp, { lang, brand, limit: 6 }),
  ])];
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  const bySource = [...counts.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);
  const phrases = [...candidates]
    .sort(byVolume)
    .slice(0, 24)
    .map((c) => ({ keyword: c.keyword, volume: c.volume, source: c.source }));
  return { kind: 'brainstorm', seeds, language: lang, considered: candidates.length, bySource, phrases };
}

/** Distinct target keywords across the plan, in calendar order, joined to the ledger. */
function keywordRows(strategy: Strategy, lang: LangCode, book: Map<string, StepsCandidate>): KeywordRow[] {
  const seen = new Set<string>();
  const rows: KeywordRow[] = [];
  for (const slot of strategy.publishing_plan ?? []) {
    const kw = slot.target_keyword?.trim();
    if (!kw) continue;
    const key = norm(kw);
    if (seen.has(key)) continue;
    seen.add(key);
    const c = book.get(key);
    const measured = c && (c.volume != null || c.difficulty != null);
    rows.push({
      keyword: kw,
      intent: classifyIntent(kw, lang),
      topic: slot.topic,
      pillarId: slot.pillar_id,
      volume: c?.volume ?? null,
      kd: c?.difficulty ?? null,
      score: measured
        ? opportunityScore({ keyword: kw, volume: c.volume, difficulty: c.difficulty, intent: null, source: c.source })
        : null,
      source: c?.source ?? null,
      secondary: slot.secondary_keywords?.length ?? 0,
    });
  }
  return rows;
}

function clusterFacts(strategy: Strategy, book: Map<string, StepsCandidate>): ClusterFacts {
  const plan = strategy.publishing_plan ?? [];
  const volumeOf = (kw: string) => book.get(norm(kw))?.volume ?? null;
  const sum = (vals: (number | null)[]): number | null =>
    vals.some((v) => v != null) ? vals.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

  // Article mode: a plan built from measured demand carries each slot's
  // cluster on the slot itself — the target is the pillar keyword, the
  // secondary phrases are the rest of the cluster the same page satisfies.
  if (plan.some((s) => (s.secondary_keywords?.length ?? 0) > 0)) {
    const clusters = plan
      .filter((s) => s.target_keyword?.trim())
      .map((s) => {
        const target = s.target_keyword!.trim();
        const members = (s.secondary_keywords ?? []).map((k) => ({ keyword: k, volume: volumeOf(k) }));
        return {
          id: s.id,
          pillarId: s.pillar_id,
          title: target,
          promise: s.topic,
          keywords: members,
          slots: 1,
          intent: s.intent,
          kd: book.get(norm(target))?.difficulty ?? null,
          total: sum([volumeOf(target), ...members.map((m) => m.volume)]),
        };
      });
    return { kind: 'cluster', mode: 'article', clusters };
  }

  // Pillar mode: before clustering existed, a pillar is the only grouping the
  // plan has — its slots' target keywords are the cluster.
  const clusters = (strategy.pillars ?? []).map((p) => {
    const slots = plan.filter((s) => s.pillar_id === p.id);
    const counts = new Map<PostSlot['intent'], number>();
    for (const s of slots) counts.set(s.intent, (counts.get(s.intent) ?? 0) + 1);
    const intent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'contextual';
    const kws = [...new Set(slots.map((s) => s.target_keyword?.trim()).filter((k): k is string => !!k))];
    return {
      id: p.id,
      pillarId: p.id,
      title: p.title,
      promise: p.promise ?? '',
      keywords: kws.map((k) => ({ keyword: k, volume: volumeOf(k) })),
      slots: slots.length,
      intent,
      kd: null,
      total: sum(kws.map(volumeOf)),
    };
  });
  return { kind: 'cluster', mode: 'pillar', clusters };
}

const WORKING = new Set(['queued', 'researching', 'writing']);

function scheduleFacts(strategy: Strategy, posts: StepsPost[], now: Date): ScheduleFacts {
  const plan = strategy.publishing_plan ?? [];
  const byId = new Map<string, StepsPost>();
  const byTopic = new Map<string, StepsPost>();
  for (const p of posts) {
    if (p.slot_id) byId.set(p.slot_id, p);
    if (p.topic) byTopic.set(p.topic.toLowerCase(), p);
  }
  const postFor = (s: PostSlot) => byId.get(s.id) ?? byTopic.get(s.topic.toLowerCase());
  let published = 0, scheduled = 0, drafting = 0, review = 0;
  const due: number[] = [];
  for (const slot of plan) {
    const p = postFor(slot);
    const st = p?.status;
    if (st === 'published') published++;
    else if (st === 'review') review++;
    else if (st === 'scheduled') scheduled++;
    else if (st && WORKING.has(st)) drafting++;
    const when = p?.scheduled_at ?? slot.publish_date;
    if (st !== 'published' && when) {
      const ts = new Date(when).getTime();
      if (ts > now.getTime()) due.push(ts);
    }
  }
  due.sort((a, b) => a - b);
  const everReviewed = posts.filter((p) => ['review', 'scheduled', 'published', 'failed'].includes(p.status)).length;
  return {
    kind: 'schedule',
    total: plan.length, published, scheduled, drafting, review,
    next: due.length ? new Date(due[0]).toISOString() : null,
    runs: { research: posts.length, drafts: posts.length, reviews: everReviewed },
  };
}

export function strategySteps(input: StepsInput): StepsModel {
  const { profile, interview, verified, strategy, posts, lang } = input;
  const now = input.now ?? new Date();
  const candidates = input.candidates ?? [];
  const book = ledger(candidates);
  const hasProfile = !!profile?.business?.name;
  const answered = interviewAnswered(interview);
  const hasPlan = !!strategy && (strategy.pillars?.length ?? 0) + (strategy.publishing_plan?.length ?? 0) > 0;
  const icp = hasPlan && strategy?.customer_profile && icpIsUsable(strategy.customer_profile) ? strategy.customer_profile : null;
  const staleReasons = input.staleReasons ?? [];
  // Only the reasons a rebuild would actually fix reopen the research step. A
  // language mismatch is not a research failure, and rebuilding on it could
  // translate a working blog — it gets its own action below.
  const rebuildReason = staleReasons.find((r) => AUTO_REBUILD_REASONS.includes(r)) ?? null;
  const stale = !!rebuildReason;

  // 1 — the crawl. It runs the moment the owner answers the interview on a
  // verified domain, so with no profile the blocker is whichever of those two
  // is missing, in that order.
  const business: Step = {
    key: 'business', n: 1,
    state: hasProfile ? 'done' : !verified ? 'needs_you' : 'pending',
    facts: hasProfile && profile ? businessFacts(profile) : null,
  };

  // 2 — the reader. A plan built from an inferred profile still profiled its
  // reader (every pillar names one), so a plan without an interview counts.
  const customers: Step = {
    key: 'customers', n: 2,
    state: answered || hasPlan ? 'done' : verified ? 'needs_you' : 'pending',
    facts: answered || hasPlan || hasProfile ? customersFacts(profile, interview, strategy, icp) : null,
  };

  // 3 — research. Once the answers are in on a verified domain, the strategist
  // is either running or about to (the hourly cron retries), so this is the
  // step "in progress" from the owner's side. A stale plan reopens it: the
  // month it planned for is over and the next one hasn't been researched.
  const canBuild = verified && answered;
  const brainstorm: Step = {
    key: 'brainstorm', n: 3,
    state: hasPlan && !stale ? 'done' : canBuild ? (stale ? 'needs_you' : 'active') : 'pending',
    facts: hasProfile || hasPlan ? brainstormFacts(profile, icp, candidates, lang) : null,
  };

  const rows = strategy && hasPlan ? keywordRows(strategy, lang, book) : [];
  const score: Step = {
    key: 'score', n: 4,
    state: hasPlan ? 'done' : 'pending',
    facts: hasPlan
      ? {
          kind: 'score',
          keywords: rows,
          scored: rows.some((r) => r.volume != null || r.kd != null),
          considered: candidates.length,
          ceiling: DEFAULT_KD_CEILING,
        }
      : null,
  };

  const cluster: Step = {
    key: 'cluster', n: 5,
    state: hasPlan && (strategy?.pillars?.length ?? 0) > 0 ? 'done' : 'pending',
    facts: strategy && hasPlan ? clusterFacts(strategy, book) : null,
  };

  // 6 — the month itself. Finished only when every slot is live; until then
  // the agent is mid-flight, which is the honest state for a running plan.
  const sched = strategy && hasPlan ? scheduleFacts(strategy, posts, now) : null;
  const schedule: Step = {
    key: 'schedule', n: 6,
    state: !sched ? 'pending' : sched.total > 0 && sched.published >= sched.total ? 'done' : 'active',
    facts: sched,
  };

  const steps = [business, customers, brainstorm, score, cluster, schedule];
  const current = steps.find((s) => s.state !== 'done')?.key ?? 'schedule';

  // The one thing the owner should do. Ordered by what unblocks the most.
  let action: NextAction;
  if (!verified) action = { kind: 'verify' };
  else if (!answered && !hasPlan) action = { kind: 'interview' };
  else if (!hasPlan) action = { kind: 'build' };
  else if (rebuildReason) action = { kind: 'rebuild', reason: rebuildReason };
  else if (staleReasons.includes('language_mismatch')) action = { kind: 'relanguage' };
  else {
    // Drafts waiting on the owner, plan-linked or not — a post written from
    // the queue outside the calendar is just as blocked on them.
    const waiting = posts.filter((p) => p.status === 'review').length;
    action = waiting > 0 ? { kind: 'review', count: waiting } : { kind: 'wait', next: sched?.next ?? null };
  }

  return { steps, current, action };
}
