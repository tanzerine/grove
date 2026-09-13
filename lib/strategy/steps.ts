/**
 * The six steps grove goes through to turn a domain into a keyword-led
 * publishing plan, as a model the dashboard can DRAW.
 *
 *   1. business    — read the site: what it sells, to whom, what's different
 *   2. customers   — profile the reader from the owner's answers + the site
 *   3. brainstorm  — the phrases those readers would actually type
 *   4. score       — keep the phrases worth chasing (demand vs. difficulty)
 *   5. cluster     — group the keepers so every article supports the others
 *   6. schedule    — one article per keyword, drafted, gated, published
 *
 * Why this exists: the strategy page showed the OUTPUT of the plan (pillars,
 * calendar, OKRs) and nothing about how it got there, and the feedback was
 * "I don't know what's going on or what I'm supposed to do". Both answers are
 * derived here from state the app already holds — the site profile, the
 * interview, the active strategy, the posts — so the tracker can never
 * disagree with the page below it. Nothing here calls the network.
 *
 * Every string a reader sees is rendered by the component; this file returns
 * keys and data only, so it can be unit-tested without a locale.
 */
import type { SiteProfile } from '../pipeline/site-profile';
import type { InterviewAnswers } from './interview';
import type { Strategy, PostSlot } from './build';
import { searchSeeds } from './seeds';
import { classifyIntent, type SearchIntent } from './keywords';
import type { LangCode } from '../language';

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
  /** What the crawl inferred about the reader. */
  inferred: string;
  /** The owner's own pick(s) — interview `audience_focus`, stored in English. */
  chosen: string[];
  goal: string | null;
  kpi: string | null;
  /** One line per pillar: who it is written for. */
  personas: { pillar: string; audience: string }[];
};

export type BrainstormFacts = {
  kind: 'brainstorm';
  /** The head terms the research starts from — derived from the profile. */
  seeds: string[];
  language: LangCode;
  /** Real phrases people search, when the build's research is on file. */
  phrases: { keyword: string; intent: SearchIntent }[];
};

export type KeywordRow = {
  keyword: string;
  intent: SearchIntent;
  /** The article it was chosen for. */
  topic: string;
  pillarId: string;
  /** Monthly searches, when a keyword data provider has scored it. */
  volume?: number | null;
  /** Keyword difficulty 0–100, same condition. */
  kd?: number | null;
};

export type ScoreFacts = {
  kind: 'score';
  keywords: KeywordRow[];
  /** True when at least one row carries volume or difficulty. */
  scored: boolean;
};

export type ClusterCard = {
  id: string;
  title: string;
  promise: string;
  keywords: string[];
  slots: number;
  /** Dominant funnel intent across its slots. */
  intent: PostSlot['intent'];
};

export type ClusterFacts = { kind: 'cluster'; clusters: ClusterCard[] };

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
  | { kind: 'rebuild' }
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

export type StepsInput = {
  profile: SiteProfile | null | undefined;
  interview: InterviewAnswers | null | undefined;
  verified: boolean;
  strategy: Strategy | null | undefined;
  posts: StepsPost[];
  lang: LangCode;
  /** The active plan is for a month that has ended (see rollover.planIsStale). */
  stale?: boolean;
  /** Persisted research from the build, when a strategy row carries it. */
  research?: { phrases?: { keyword: string; intent: SearchIntent }[] } | null;
  now?: Date;
};

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const asText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

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
  strategy: Strategy | null | undefined,
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
  };
}

/** Distinct target keywords across the plan, in calendar order. */
function keywordRows(strategy: Strategy, lang: LangCode): KeywordRow[] {
  const seen = new Set<string>();
  const rows: KeywordRow[] = [];
  for (const slot of strategy.publishing_plan ?? []) {
    const kw = slot.target_keyword?.trim();
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ keyword: kw, intent: classifyIntent(kw, lang), topic: slot.topic, pillarId: slot.pillar_id });
  }
  return rows;
}

function clusterCards(strategy: Strategy): ClusterCard[] {
  const plan = strategy.publishing_plan ?? [];
  return (strategy.pillars ?? []).map((p) => {
    const slots = plan.filter((s) => s.pillar_id === p.id);
    const counts = new Map<PostSlot['intent'], number>();
    for (const s of slots) counts.set(s.intent, (counts.get(s.intent) ?? 0) + 1);
    const intent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'contextual';
    const keywords = [...new Set(slots.map((s) => s.target_keyword?.trim()).filter((k): k is string => !!k))];
    return { id: p.id, title: p.title, promise: p.promise ?? '', keywords, slots: slots.length, intent };
  });
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
  const hasProfile = !!profile?.business?.name;
  const answered = interviewAnswered(interview);
  const hasPlan = !!strategy && (strategy.pillars?.length ?? 0) + (strategy.publishing_plan?.length ?? 0) > 0;
  const stale = !!input.stale;

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
    facts: answered || hasPlan || hasProfile ? customersFacts(profile, interview, strategy) : null,
  };

  // 3 — research. Once the answers are in on a verified domain, the strategist
  // is either running or about to (the hourly cron retries), so this is the
  // step "in progress" from the owner's side. A stale plan reopens it: the
  // month it planned for is over and the next one hasn't been researched.
  const canBuild = verified && answered;
  const brainstorm: Step = {
    key: 'brainstorm', n: 3,
    state: hasPlan && !stale ? 'done' : canBuild ? (stale ? 'needs_you' : 'active') : 'pending',
    facts: hasProfile || hasPlan
      ? {
          kind: 'brainstorm',
          seeds: searchSeeds(profile, { limit: 8 }),
          language: lang,
          phrases: (input.research?.phrases ?? []).slice(0, 36),
        }
      : null,
  };

  const rows = strategy && hasPlan ? keywordRows(strategy, lang) : [];
  const score: Step = {
    key: 'score', n: 4,
    state: hasPlan ? 'done' : 'pending',
    facts: hasPlan ? { kind: 'score', keywords: rows, scored: rows.some((r) => r.volume != null || r.kd != null) } : null,
  };

  const cluster: Step = {
    key: 'cluster', n: 5,
    state: hasPlan && (strategy?.pillars?.length ?? 0) > 0 ? 'done' : 'pending',
    facts: strategy && hasPlan ? { kind: 'cluster', clusters: clusterCards(strategy) } : null,
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
  else if (stale) action = { kind: 'rebuild' };
  else {
    // Drafts waiting on the owner, plan-linked or not — a post written from
    // the queue outside the calendar is just as blocked on them.
    const waiting = posts.filter((p) => p.status === 'review').length;
    action = waiting > 0 ? { kind: 'review', count: waiting } : { kind: 'wait', next: sched?.next ?? null };
  }

  return { steps, current, action };
}
