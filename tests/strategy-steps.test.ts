import { describe, it, expect } from 'vitest';
import { strategySteps, interviewAnswered, STEP_KEYS, type StepsInput } from '@/lib/strategy/steps';
import type { SiteProfile } from '@/lib/pipeline/site-profile';
import type { Strategy } from '@/lib/strategy/build';
import { opportunityScore } from '@/lib/keywords/opportunity';

/**
 * The tracker's whole promise is that it never disagrees with the page under
 * it, so every state here is derived from the same rows the page reads. These
 * pin the derivation: which step is "current" for each stage of a domain's
 * life, and what the one thing the owner should do is.
 */

const PROFILE = {
  business: {
    name: 'Grove',
    industry: 'AI Marketing Software / B2B SaaS',
    description: 'An agentic SEO blog that researches, writes and publishes on autopilot.',
    products_services: ['Autonomous AI blog writing', 'One-line embed blog hosting'],
    target_audience: 'Founders of small SaaS companies without a marketing team',
    value_props: ['Zero upkeep'],
    geography: 'global',
  },
  voice: { persona: '', tone: '', register: '', vocabulary: [], we_are: [], we_are_not: [], signature_moves: [], avoid: [], samples: [] },
  branding: null,
  design: null,
  meta: { has_blog: true, has_pricing: true, pages_crawled: ['/', '/pricing', '/blog'] },
} as unknown as SiteProfile;

const INTERVIEW = {
  primary_goal: 'capture organic search traffic',
  primary_kpi: 'organic search sessions',
  audience_focus: ['founders / solo product owners', 'marketing / growth ops'],
};

const STRATEGY: Strategy = {
  month: '2026-09',
  source: 'interview',
  goals: [{ id: 'traffic', title: 'Grow organic traffic', why: '' }],
  kpis: [{ id: 'k1', goal_id: 'traffic', metric: 'organic_share', target: 30 }],
  pillars: [
    { id: 'p1', title: 'Blog automation', intent_mix: { editorial: 0.5, contextual: 0.3, conversion: 0.2 }, audience: 'Solo founders', promise: 'Publish without a team' },
    { id: 'p2', title: 'SEO for SaaS', intent_mix: { editorial: 0.2, contextual: 0.3, conversion: 0.5 }, audience: 'Growth marketers', promise: 'Rank for what buyers search' },
  ],
  publishing_plan: [
    { id: 's1', pillar_id: 'p1', goal_id: 'traffic', kpi_id: 'k1', topic: 'How to automate a company blog', intent: 'editorial', target_keyword: 'automate blog posts', publish_date: '2026-09-03T09:00:00Z' },
    { id: 's2', pillar_id: 'p1', goal_id: 'traffic', kpi_id: 'k1', topic: 'Blog automation tools compared', intent: 'contextual', target_keyword: 'best blog automation tools', publish_date: '2026-09-10T09:00:00Z' },
    { id: 's3', pillar_id: 'p2', goal_id: 'traffic', kpi_id: 'k1', topic: 'SaaS SEO playbook', intent: 'conversion', target_keyword: 'saas seo strategy', publish_date: '2026-09-17T09:00:00Z' },
    // Same query as s2 in a different word order — the plan should still show one keyword per query.
    { id: 's4', pillar_id: 'p2', goal_id: 'traffic', kpi_id: 'k1', topic: 'Tools roundup', intent: 'contextual', target_keyword: 'Best Blog Automation Tools', publish_date: '2026-09-24T09:00:00Z' },
  ],
  notes: '',
};

/** The customer profile the plan was built for (lib/strategy/icp.ts). */
const ICP = {
  segments: [{ name: 'solo founder running a SaaS side project', situation: 'no marketing hire, ships on weekends' }],
  jobs: ['get organic traffic without hiring writers'],
  pains: ['blog has been empty for months', 'no time to write'],
  triggers: ['a competitor started ranking'],
  vocabulary: ['automate blog posts', 'blog automation tools', 'saas seo strategy'],
  objections: ['ai content reads like ai content'],
};

/** keyword_candidates rows — the ledger the keepers were picked from. */
const LEDGER = [
  { keyword: 'automate blog posts', source: 'dataforseo', volume: 880, difficulty: 22, intent: 'informational', status: 'planned' },
  { keyword: 'Best Blog Automation Tools', source: 'dataforseo', volume: 590, difficulty: 28, intent: 'commercial', status: 'planned' },
  { keyword: 'saas seo strategy', source: 'dataforseo', volume: 1300, difficulty: 41, intent: 'informational', status: 'planned' },
  { keyword: 'blog automation software', source: 'dataforseo', volume: 210, difficulty: 19, intent: 'commercial', status: 'new' },
  { keyword: 'automated blogging', source: 'dataforseo', volume: 320, difficulty: 25, intent: 'informational', status: 'new' },
  { keyword: 'how to automate a blog', source: 'autocomplete', volume: null, difficulty: null, intent: 'informational', status: 'new' },
];

/** A plan from measured demand: every slot carries its cluster. */
const CLUSTERED: Strategy = {
  ...STRATEGY,
  customer_profile: ICP,
  publishing_plan: [
    { ...STRATEGY.publishing_plan[0], secondary_keywords: ['automated blogging', 'how to automate a blog'] },
    { ...STRATEGY.publishing_plan[1], secondary_keywords: ['blog automation software'] },
    { ...STRATEGY.publishing_plan[2], secondary_keywords: [] },
  ],
} as Strategy;

const NOW = new Date('2026-09-12T12:00:00Z');

function input(over: Partial<StepsInput> = {}): StepsInput {
  return { profile: PROFILE, interview: INTERVIEW, verified: true, strategy: STRATEGY, posts: [], lang: 'en', now: NOW, ...over };
}

const stateOf = (m: ReturnType<typeof strategySteps>) => Object.fromEntries(m.steps.map((s) => [s.key, s.state]));

describe('the six steps, in order', () => {
  it('always returns all six, numbered 1–6', () => {
    const m = strategySteps(input());
    expect(m.steps.map((s) => s.key)).toEqual([...STEP_KEYS]);
    expect(m.steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('a running plan', () => {
  it('has steps 1–5 done, step 6 active, and nothing for the owner to do', () => {
    const m = strategySteps(input({ posts: [{ status: 'published', slot_id: 's1' }, { status: 'scheduled', slot_id: 's2', scheduled_at: '2026-09-14T09:00:00Z' }] }));
    expect(stateOf(m)).toEqual({ business: 'done', customers: 'done', brainstorm: 'done', score: 'done', cluster: 'done', schedule: 'active' });
    expect(m.current).toBe('schedule');
    expect(m.action).toEqual({ kind: 'wait', next: '2026-09-14T09:00:00.000Z' });
  });

  it('counts the month from the posts, matched by slot id or topic', () => {
    const m = strategySteps(input({ posts: [
      { status: 'published', slot_id: 's1' },
      { status: 'published', topic: 'SaaS SEO playbook' },        // matched by topic
      { status: 'writing', slot_id: 's2' },
      { status: 'review', slot_id: 's4' },
    ] }));
    const sched = m.steps[5].facts;
    expect(sched?.kind).toBe('schedule');
    if (sched?.kind !== 'schedule') return;
    expect(sched).toMatchObject({ total: 4, published: 2, drafting: 1, review: 1, scheduled: 0 });
    // s2 is being written and s4 is in review — the next due date is the
    // earliest unpublished slot's, not a published one's.
    expect(sched.next).toBe('2026-09-24T09:00:00.000Z');
  });

  it('asks the owner to review drafts before anything else, plan-linked or not', () => {
    const m = strategySteps(input({ posts: [{ status: 'review' }, { status: 'review', slot_id: 's1' }] }));
    expect(m.action).toEqual({ kind: 'review', count: 2 });
  });

  it('is finished once every slot is live', () => {
    const posts = STRATEGY.publishing_plan.map((s) => ({ status: 'published', slot_id: s.id }));
    const m = strategySteps(input({ posts }));
    expect(m.steps[5].state).toBe('done');
    expect(m.current).toBe('schedule');
    expect(m.action).toEqual({ kind: 'wait', next: null });
  });

  it('lists one keyword per distinct query, classified by intent, in calendar order', () => {
    const m = strategySteps(input());
    const score = m.steps[3].facts;
    if (score?.kind !== 'score') throw new Error('no score facts');
    expect(score.keywords.map((k) => k.keyword)).toEqual(['automate blog posts', 'best blog automation tools', 'saas seo strategy']);
    expect(score.keywords.map((k) => k.intent)).toEqual(['informational', 'commercial', 'informational']);
    expect(score.scored).toBe(false);   // no volume/difficulty provider yet
  });

  it('falls back to one cluster per pillar for a plan from before clustering existed', () => {
    const m = strategySteps(input());
    const c = m.steps[4].facts;
    if (c?.kind !== 'cluster') throw new Error('no cluster facts');
    expect(c.mode).toBe('pillar');
    expect(c.clusters).toHaveLength(2);
    expect(c.clusters[0]).toMatchObject({ title: 'Blog automation', slots: 2, total: null });
    expect(c.clusters[0].keywords.map((k) => k.keyword)).toEqual(['automate blog posts', 'best blog automation tools']);
    // p2 has one conversion slot and one contextual — a tie, broken by first
    // seen; what matters is that the dominant intent is one of its own.
    expect(['conversion', 'contextual']).toContain(c.clusters[1].intent);
    expect(c.clusters[1].keywords.map((k) => k.keyword)).toEqual(['saas seo strategy', 'Best Blog Automation Tools']);
  });

  it('profiles the reader from the answers, the crawl and the pillars', () => {
    const m = strategySteps(input());
    const c = m.steps[1].facts;
    if (c?.kind !== 'customers') throw new Error('no customer facts');
    expect(c.chosen).toEqual(['founders / solo product owners', 'marketing / growth ops']);
    expect(c.inferred).toMatch(/Founders/);
    expect(c.goal).toBe('capture organic search traffic');
    expect(c.personas).toEqual([{ pillar: 'Blog automation', audience: 'Solo founders' }, { pillar: 'SEO for SaaS', audience: 'Growth marketers' }]);
  });

  it('starts the brainstorm from the site\'s head terms when no customer profile is on file, never the brand', () => {
    const m = strategySteps(input());
    const b = m.steps[2].facts;
    if (b?.kind !== 'brainstorm') throw new Error('no brainstorm facts');
    expect(b.seeds.length).toBeGreaterThan(0);
    expect(b.seeds.some((s) => /grove/i.test(s))).toBe(false);
    expect(b.language).toBe('en');
    expect(b.considered).toBe(0);
    expect(b.phrases).toEqual([]);
  });
});

describe('a plan built from measured demand', () => {
  const m = strategySteps(input({ strategy: CLUSTERED, candidates: LEDGER }));

  it('shows the customer the strategist planned for', () => {
    const c = m.steps[1].facts;
    if (c?.kind !== 'customers') throw new Error('no customer facts');
    expect(c.icp?.segments[0].name).toMatch(/solo founder/);
    expect(c.icp?.vocabulary).toContain('automate blog posts');
    expect(c.icp?.pains).toHaveLength(2);
  });

  it('seeds the brainstorm from the customer\'s words, and counts what the research found', () => {
    const b = m.steps[2].facts;
    if (b?.kind !== 'brainstorm') throw new Error('no brainstorm facts');
    // icpSeeds: vocabulary first, narrowed by seedCandidates — the customer's
    // phrases, not the site's product names.
    expect(b.seeds[0]).toBe('automate blog posts');
    expect(b.seeds.some((s) => /embed blog hosting/.test(s))).toBe(false);
    expect(b.considered).toBe(6);
    expect(b.bySource).toEqual([{ source: 'dataforseo', n: 5 }, { source: 'autocomplete', n: 1 }]);
    // most-searched first, the unmeasured autocomplete phrase last
    expect(b.phrases[0]).toMatchObject({ keyword: 'saas seo strategy', volume: 1300 });
    expect(b.phrases[b.phrases.length - 1]).toMatchObject({ keyword: 'how to automate a blog', volume: null });
  });

  it('joins each kept keyword to its volume, difficulty and expected impressions', () => {
    const sc = m.steps[3].facts;
    if (sc?.kind !== 'score') throw new Error('no score facts');
    expect(sc.scored).toBe(true);
    expect(sc.considered).toBe(6);
    const [a, b, c] = sc.keywords;
    expect(a).toMatchObject({ keyword: 'automate blog posts', volume: 880, kd: 22, secondary: 2, source: 'dataforseo' });
    // The arithmetic is lib/keywords/opportunity's, not re-derived here: KD 22
    // sits inside the 30 ceiling's decay band, so expected impressions are a
    // measured fraction of the 880 searches, not the whole number.
    expect(a.score).toBe(opportunityScore({ keyword: a.keyword, volume: 880, difficulty: 22, intent: null, source: 'dataforseo' }));
    expect(a.score).toBeLessThan(880);
    // joined case-insensitively: the plan says lowercase, the ledger title-cased it
    expect(b).toMatchObject({ keyword: 'best blog automation tools', volume: 590, kd: 28 });
    // KD 41 is past the ceiling: expected impressions shrink, never fabricate
    expect(c.kd).toBe(41);
    expect(c.score).toBeLessThan(1300);
    expect(c.score).toBeGreaterThan(0);
  });

  it('draws one cluster per article: the target, the phrases it also covers, and the whole prize', () => {
    const c = m.steps[4].facts;
    if (c?.kind !== 'cluster') throw new Error('no cluster facts');
    expect(c.mode).toBe('article');
    expect(c.clusters).toHaveLength(3);
    expect(c.clusters[0]).toMatchObject({
      title: 'automate blog posts', promise: 'How to automate a company blog', kd: 22, slots: 1,
      // 880 + 320 + (unmeasured counts as 0, but the total is still measured)
      total: 1200,
    });
    expect(c.clusters[0].keywords).toEqual([
      { keyword: 'automated blogging', volume: 320 },
      { keyword: 'how to automate a blog', volume: null },
    ]);
    // a cluster with no secondary phrases is still one article
    expect(c.clusters[2]).toMatchObject({ title: 'saas seo strategy', keywords: [], total: 1300 });
  });

  it('a profile too thin to research from is not shown as the reader', () => {
    const thin = { ...CLUSTERED, customer_profile: { segments: [], jobs: [], pains: [], triggers: [], vocabulary: ['x'], objections: [] } } as Strategy;
    const t = strategySteps(input({ strategy: thin }));
    const c = t.steps[1].facts;
    if (c?.kind !== 'customers') throw new Error('no customer facts');
    expect(c.icp).toBeNull();
  });
});

describe('before there is a plan', () => {
  it('an unverified domain is blocked at step 1, on the owner', () => {
    const m = strategySteps(input({ profile: null, interview: null, verified: false, strategy: null }));
    expect(stateOf(m)).toEqual({ business: 'needs_you', customers: 'pending', brainstorm: 'pending', score: 'pending', cluster: 'pending', schedule: 'pending' });
    expect(m.current).toBe('business');
    expect(m.action).toEqual({ kind: 'verify' });
  });

  it('a verified domain with no answers waits on the interview', () => {
    const m = strategySteps(input({ interview: null, strategy: null }));
    expect(stateOf(m)).toMatchObject({ business: 'done', customers: 'needs_you', brainstorm: 'pending' });
    expect(m.current).toBe('customers');
    expect(m.action).toEqual({ kind: 'interview' });
  });

  it('answers on file and no plan means the strategist is the one working', () => {
    const m = strategySteps(input({ strategy: null }));
    expect(stateOf(m)).toMatchObject({ business: 'done', customers: 'done', brainstorm: 'active', score: 'pending' });
    expect(m.current).toBe('brainstorm');
    expect(m.action).toEqual({ kind: 'build' });
  });

  it('a failed crawl does not hide the interview step behind it', () => {
    // The interview route plans from a hostname-only profile, so a verified
    // owner with no crawl on file should still be pointed at the questions.
    const m = strategySteps(input({ profile: null, interview: null, strategy: null }));
    expect(stateOf(m)).toMatchObject({ business: 'pending', customers: 'needs_you' });
    expect(m.action).toEqual({ kind: 'interview' });
  });

  it('an empty strategy row is not a plan', () => {
    const empty = { ...STRATEGY, pillars: [], publishing_plan: [] };
    const m = strategySteps(input({ strategy: empty }));
    expect(m.steps[2].state).toBe('active');
    expect(m.action).toEqual({ kind: 'build' });
  });
});

describe('a plan from a month that has ended', () => {
  it('reopens the research step and asks for a rebuild, keeping last month\'s artifacts', () => {
    const m = strategySteps(input({ stale: true }));
    expect(m.steps[2].state).toBe('needs_you');
    expect(m.current).toBe('brainstorm');
    expect(m.action).toEqual({ kind: 'rebuild' });
    expect(m.steps[4].facts?.kind).toBe('cluster');
  });
});

describe('interviewAnswered', () => {
  it('needs at least one real answer', () => {
    expect(interviewAnswered(null)).toBe(false);
    expect(interviewAnswered({})).toBe(false);
    expect(interviewAnswered({ audience_focus: [] })).toBe(false);
    expect(interviewAnswered({ off_limits: '   ' })).toBe(false);
    expect(interviewAnswered({ primary_goal: 'capture organic search traffic' })).toBe(true);
  });
});
