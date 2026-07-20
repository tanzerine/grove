import { describe, it, expect } from 'vitest';
import { parseSlash, classifyIntent, writeTopicFrom, isAffirmation } from '../lib/assistant/triage';
import { pickTitleCandidates, sanitizeRewrites, TITLE_LIMITS } from '../lib/assistant/titles';
import { resolvePost, parseWhen, extractReschedule, type PostRef } from '../lib/assistant/pipeline';
import type { ContentRow } from '../lib/search-console/insights';
import { relevantKnowledge } from '../lib/assistant/knowledge';
import { signalsBlock, type AssistantSignals } from '../lib/assistant/context';
import { buildAnswerPrompt, NO_ACCESS_RX, sanitizeHistory, guardReply, normalizeAnswer } from '../lib/assistant/chat';

describe('parseSlash', () => {
  it('parses a known command and its remainder', () => {
    expect(parseSlash('/analytics What is driving clicks?')).toEqual({
      intent: 'analytics', rest: 'What is driving clicks?',
    });
    expect(parseSlash('/write Queue this week’s onboarding post')).toEqual({
      intent: 'write', rest: 'Queue this week’s onboarding post',
    });
    expect(parseSlash('  /HELP canonical url ')).toEqual({ intent: 'help', rest: 'canonical url' });
  });

  it('returns null for unknown commands and plain text', () => {
    expect(parseSlash('/deploy now')).toBeNull();
    expect(parseSlash('what is up')).toBeNull();
    expect(parseSlash('a/b testing')).toBeNull();
  });
});

describe('classifyIntent', () => {
  it('slash command wins over content heuristics', () => {
    expect(classifyIntent('/strategy why so many views posts?')).toBe('strategy');
    expect(classifyIntent('/write more clicks please')).toBe('write');
  });

  it('routes the example prompts to the right intents', () => {
    expect(classifyIntent("whats the reason this month is lacking new viewers?")).toBe('analytics');
    expect(classifyIntent('I want to write new article about pour-over recipes')).toBe('write');
    expect(classifyIntent('can you tell me how to setup canonical url')).toBe('help');
  });

  it('acquisition phrasing is an analytics question', () => {
    expect(classifyIntent('Am I getting new users with this current strategy?')).toBe('analytics');
    expect(classifyIntent('how many signups came from the blog?')).toBe('analytics');
  });

  it('how-to phrasing beats the strategy word-net, analytics terms beat help', () => {
    expect(classifyIntent('how do I set up the publishing schedule?')).toBe('help');
    expect(classifyIntent('how do I get more clicks?')).toBe('analytics');
    expect(classifyIntent('what should we publish next month? any plan?')).toBe('strategy');
  });

  it('routes plan changes to revise', () => {
    expect(classifyIntent('add two more conversion posts')).toBe('revise');
    expect(classifyIntent('drop the pricing pillar')).toBe('revise');
    expect(classifyIntent('can you focus the plan more on comparisons')).toBe('revise');
    expect(classifyIntent('/strategy add two more conversion posts')).toBe('revise');
    // softer steering verbs count too — this exact phrasing once fell to
    // analytics and the answer model role-played the revision
    expect(classifyIntent('can you adjust the strategy a little to boost up the conversion rate?')).toBe('revise');
    expect(classifyIntent('tweak the plan to favor tutorials')).toBe('revise');
  });

  it('question-phrased plan talk stays a question, not a revision', () => {
    expect(classifyIntent('why did you add so many conversion posts?')).not.toBe('revise');
    expect(classifyIntent('/strategy why are there so many pillar posts?')).toBe('strategy');
    // steering verb without a plan noun is not a revision either
    expect(classifyIntent('I need more clicks')).not.toBe('revise');
  });

  it('an explicit write ask still beats revise', () => {
    expect(classifyIntent('add a post about cold brew')).toBe('write');
  });

  it('routes title-improvement asks to the titles action', () => {
    expect(classifyIntent('improve my low-CTR titles')).toBe('titles');
    expect(classifyIntent('rewrite the titles that get no clicks')).toBe('titles');
    expect(classifyIntent('/analytics improve titles')).toBe('titles');
    expect(classifyIntent('제목 좀 개선해줘')).toBe('titles');
  });

  it('title questions are answered, not acted on', () => {
    expect(classifyIntent('why are my titles not getting clicks?')).not.toBe('titles');
    // and an article about titles is still a write ask
    expect(classifyIntent('write an article about page titles')).toBe('write');
  });

  it('routes pipeline actions on existing posts', () => {
    expect(classifyIntent('approve the onboarding draft')).toBe('approve');
    expect(classifyIntent('publish the draft in review')).toBe('approve');
    expect(classifyIntent('retry the failed post')).toBe('retry');
    expect(classifyIntent('regenerate it')).toBe('retry');
    expect(classifyIntent('move the launch post to Friday')).toBe('reschedule');
    expect(classifyIntent('reschedule the pricing article to tomorrow')).toBe('reschedule');
  });

  it('separates reschedule from plan revision and from write', () => {
    // "move" + plan noun (no date) is a revision, not a reschedule
    expect(classifyIntent('move the pricing pillar out of the plan')).toBe('revise');
    // reschedule with a date beats the write "post" noun
    expect(classifyIntent('push the launch post to next Monday')).toBe('reschedule');
    // asking how to approve is help, not an approve action
    expect(classifyIntent('how do I approve a draft?')).toBe('help');
  });

  it('falls back to general', () => {
    expect(classifyIntent('good morning!')).toBe('general');
  });

  it('handles Korean phrasing', () => {
    expect(classifyIntent('이번 달 트래픽이 왜 이래?')).toBe('analytics');
    expect(classifyIntent('커피 원두 보관에 대한 글 써줘')).toBe('write');
    expect(classifyIntent('커스텀 도메인 설정 어떻게 해?')).toBe('help');
  });
});

describe('isAffirmation', () => {
  it('accepts bare confirmations, with trailing punctuation', () => {
    expect(isAffirmation('yes')).toBe(true);
    expect(isAffirmation('Yes please!')).toBe(true);
    expect(isAffirmation('do it')).toBe(true);
    expect(isAffirmation('go ahead')).toBe(true);
    expect(isAffirmation('ok')).toBe(true);
    expect(isAffirmation('sounds good.')).toBe(true);
    expect(isAffirmation('네')).toBe(true);
    expect(isAffirmation('해줘')).toBe(true);
  });

  it('rejects anything with extra content or unrelated words', () => {
    expect(isAffirmation('yes but drop the listicle')).toBe(false);
    expect(isAffirmation('yesterday was slow')).toBe(false);
    expect(isAffirmation('no')).toBe(false);
    expect(isAffirmation('ok how do I set up DNS?')).toBe(false);
  });
});

describe('writeTopicFrom', () => {
  it('strips the verb phrase and keeps the topic', () => {
    expect(writeTopicFrom('I want to write new article about pour-over recipes')).toBe('pour-over recipes');
    expect(writeTopicFrom('write an article about spring onboarding tips')).toBe('spring onboarding tips');
    expect(writeTopicFrom('Can you draft a post on cold brew ratios?')).toBe('cold brew ratios');
  });

  it('uses the slash remainder', () => {
    expect(writeTopicFrom('/write an article about winter menus')).toBe('winter menus');
  });

  it('returns empty when no topic remains', () => {
    expect(writeTopicFrom('write an article')).toBe('');
    expect(writeTopicFrom('/write')).toBe('');
  });

  it('handles Korean requests', () => {
    expect(writeTopicFrom('원두 보관법에 대한 글 써줘')).toBe('원두 보관법');
  });
});

describe('relevantKnowledge', () => {
  it('finds the canonical-url guide', () => {
    const hits = relevantKnowledge('how to setup canonical url');
    expect(hits.map((s) => s.id)).toContain('canonical-url');
  });

  it('finds the cname guide for custom domain questions', () => {
    const hits = relevantKnowledge('point my blog to a custom domain via CNAME');
    expect(hits[0].id).toBe('custom-hostname');
  });

  it('returns at most two sections, empty when nothing matches', () => {
    expect(relevantKnowledge('embed the widget with canonical sitemap dns cname').length).toBeLessThanOrEqual(2);
    expect(relevantKnowledge('good morning')).toEqual([]);
  });
});

const row = (over: Partial<ContentRow>): ContentRow => ({
  postId: 'p1', title: 'A title', path: '/a', views: 0,
  clicks: 1, impressions: 200, ctr: 0.005, position: 12,
  ...over,
});

describe('pickTitleCandidates', () => {
  it('keeps only high-impression low-CTR articles, biggest pools first', () => {
    const picked = pickTitleCandidates([
      row({ postId: 'small', impressions: 20 }),                    // too little signal
      row({ postId: 'fine', impressions: 900, clicks: 90, ctr: 0.1 }), // already clicked
      row({ postId: 'worst', impressions: 800 }),
      row({ postId: 'bad', impressions: 300 }),
      row({ postId: null, impressions: 999 }),                      // no post to edit
    ]);
    expect(picked.map((c) => c.postId)).toEqual(['worst', 'bad']);
  });

  it('caps the batch at maxRewrites', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => row({ postId: id }));
    expect(pickTitleCandidates(many)).toHaveLength(TITLE_LIMITS.maxRewrites);
  });
});

describe('sanitizeRewrites', () => {
  const candidates = pickTitleCandidates([
    row({ postId: 'p1', title: 'Old title one' }),
    row({ postId: 'p2', title: 'Old title two' }),
  ]);

  it('applies valid rewrites and preserves the old title for undo', () => {
    const out = sanitizeRewrites([{ post_id: 'p1', title: '  New   sharper title ' }], candidates);
    expect(out).toEqual([{ post_id: 'p1', from: 'Old title one', to: 'New sharper title' }]);
  });

  it('drops unknown posts, unchanged titles, junk lengths and duplicates', () => {
    const out = sanitizeRewrites([
      { post_id: 'ghost', title: 'A perfectly fine title' },
      { post_id: 'p1', title: 'old title ONE' },          // same title, case aside
      { post_id: 'p2', title: 'short' },                  // < 8 chars
      { post_id: 'p2', title: 'x'.repeat(91) },           // > 90 chars
      { post_id: 'p2', title: 'A good replacement title' },
      { post_id: 'p2', title: 'A second replacement' },   // duplicate post
    ], candidates);
    expect(out).toEqual([{ post_id: 'p2', from: 'Old title two', to: 'A good replacement title' }]);
  });
});

describe('resolvePost', () => {
  const posts: PostRef[] = [
    { id: 'a', title: 'Onboarding tips for new teams', status: 'review', scheduled_at: null },
    { id: 'b', title: 'Cold brew ratios explained', status: 'review', scheduled_at: null },
  ];

  it('matches by a title word', () => {
    expect(resolvePost('approve the onboarding draft', posts)).toEqual({ kind: 'one', post: posts[0] });
    expect(resolvePost('publish cold brew', posts)).toEqual({ kind: 'one', post: posts[1] });
  });

  it('uses the single candidate when no selector is given', () => {
    expect(resolvePost('approve it', [posts[0]])).toEqual({ kind: 'one', post: posts[0] });
  });

  it('is ambiguous when no selector and several candidates', () => {
    const r = resolvePost('approve the draft', posts);
    expect(r.kind).toBe('many');
  });

  it('reports none when there are no candidates', () => {
    expect(resolvePost('approve it', [])).toEqual({ kind: 'none' });
  });

  it('matches a weekday selector against the scheduled day', () => {
    // 2026-07-23 is a Thursday, 2026-07-20 a Monday.
    const scheduled: PostRef[] = [
      { id: 'thu', title: 'Launch recap', status: 'scheduled', scheduled_at: '2026-07-23T09:00:00Z' },
      { id: 'mon', title: 'Weekly digest', status: 'scheduled', scheduled_at: '2026-07-20T09:00:00Z' },
    ];
    expect(resolvePost('move thursday post', scheduled)).toEqual({ kind: 'one', post: scheduled[0] });
  });
});

describe('parseWhen', () => {
  // A Wednesday, so weekday math is easy to reason about.
  const now = new Date('2026-07-15T12:00:00Z');

  it('parses tomorrow at the default hour', () => {
    expect(parseWhen('tomorrow', now)?.at).toBe('2026-07-16T09:00:00.000Z');
  });

  it('parses a weekday as the next occurrence', () => {
    // next Friday from Wed 15th is the 17th
    expect(parseWhen('friday', now)?.at).toBe('2026-07-17T09:00:00.000Z');
    // "monday" → the 20th
    expect(parseWhen('monday', now)?.at).toBe('2026-07-20T09:00:00.000Z');
  });

  it('"next <weekday>" jumps a further week', () => {
    expect(parseWhen('next friday', now)?.at).toBe('2026-07-24T09:00:00.000Z');
  });

  it('honours an explicit time', () => {
    expect(parseWhen('tomorrow at 3pm', now)?.at).toBe('2026-07-16T15:00:00.000Z');
    expect(parseWhen('monday at 14:30', now)?.at).toBe('2026-07-20T14:30:00.000Z');
  });

  it('parses in N days, and returns null for unparseable text', () => {
    expect(parseWhen('in 3 days', now)?.at).toBe('2026-07-18T09:00:00.000Z');
    expect(parseWhen('sometime soon', now)).toBeNull();
    // "next month" is plan talk, not a date this parser handles
    expect(parseWhen('next month', now)).toBeNull();
  });
});

describe('extractReschedule', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  it('splits target after "to" from the selector', () => {
    const r = extractReschedule('move the launch post to Friday', now);
    expect(r.when?.at).toBe('2026-07-17T09:00:00.000Z');
    expect(r.selector).toBe('move the launch post');
  });

  it('keeps a selector weekday out of the target', () => {
    const r = extractReschedule('move Thursday post to Monday', now);
    expect(r.when?.at).toBe('2026-07-20T09:00:00.000Z');   // Monday the 20th
    expect(r.selector).toBe('move Thursday post');           // Thursday stays as the selector
  });

  it('falls back to scanning the whole string when there is no preposition', () => {
    const r = extractReschedule('publish the pricing draft tomorrow', now);
    expect(r.when?.at).toBe('2026-07-16T09:00:00.000Z');
  });
});

const SIGNALS: AssistantSignals = {
  brief: {
    hostname: 'acme.com', publishedThisWeek: 2, totalPublished: 14,
    readsThisWeek: 120, readsLastWeek: 90, conversionsThisWeek: 5,
    organicShare: 0.4, inReview: 1, inFlight: 2,
    nextScheduledAt: '2026-07-20T09:00:00Z',
    topPost: { title: 'Hello', views: 40 },
  },
  month: {
    views: 300, prevViews: 500, uniqueSessions: 210,
    conversions: 9, prevConversions: 4, organicShare: 0.35,
    medianDwellSec: 74, outboundRate: 0.08,
    topPosts: [{ title: 'Best post', views: 80, conversions: 3 }],
  },
  articles: [
    { title: 'Best post', reads: 80, clicks: 30, impressions: 1500, ctr: 0.02, position: 9.2 },
    { title: 'Quiet post', reads: 4, clicks: 0, impressions: 0, ctr: 0, position: 0 },
  ],
  articlesTotal: 14,
  funnel: { clicks: 210, read50: 120, converted: 9 },
  traffic: { total: 210, sources: [{ key: 'search', name: 'Search', clicks: 120, pct: 57 }, { key: 'direct', name: 'Direct', clicks: 90, pct: 43 }] },
  engagement: { views: 300, events: 900, sessions: 210, avgDwellSec: 81 },
  gsc: { clicks: 42, impressions: 2100, ctr: 0.02, avgPosition: 18.4 },
  ga: { views: 4200, activeUsers: 1900, avgEngagementSec: 62 },
  setup: {
    gscConnected: true, ga4Connected: true, canonicalBase: null,
    customHostname: null, autoPublish: true, postsPerWeek: 4,
  },
};

describe('signalsBlock', () => {
  it('renders every section with the real numbers', () => {
    const md = signalsBlock(SIGNALS);
    expect(md).toContain('14 total');
    expect(md).toContain('300 article reads across 210 unique readers (previous month total 500)');
    expect(md).toContain('9 conversions (previous month 4)');
    expect(md).toContain('42 clicks from 2100 impressions (CTR 2%)');
    expect(md).toContain('Next scheduled publish: 2026-07-20');
    expect(md).toContain('canonical base not set');
    expect(md).toContain('autopilot ON');
  });

  it('answers the new-users question directly via the funnel line', () => {
    const md = signalsBlock(SIGNALS);
    expect(md).toContain('210 opened an article → 120 read past halfway → 9 converted');
    expect(md).toContain('New users FROM THE BLOG = that last number');
  });

  it('lists per-article live numbers, flagging pre-search articles honestly', () => {
    const md = signalsBlock(SIGNALS);
    expect(md).toContain('"Best post" — 80 reads, 30 clicks / 1500 impressions (CTR 2%), avg position 9.2');
    expect(md).toContain('"Quiet post" — 4 reads, no search impressions yet');
    expect(md).toContain('and 12 more articles');
  });

  it('includes traffic sources and whole-site GA', () => {
    const md = signalsBlock(SIGNALS);
    expect(md).toContain('Search 57%, Direct 43% of 210 arrivals');
    expect(md).toContain('4200 pageviews, 1900 active users');
  });

  it('says GSC/GA are missing instead of inventing zeros', () => {
    const md = signalsBlock({
      ...SIGNALS, gsc: null, ga: null,
      setup: { ...SIGNALS.setup, gscConnected: false, ga4Connected: false },
    });
    expect(md).toContain('NOT connected');
    expect(md).toContain('Google Analytics: not connected');
  });
});

describe('buildAnswerPrompt', () => {
  it('carries the data in the USER prompt: signals, plan memo, guides, transcript', () => {
    const { system, user } = buildAnswerPrompt({
      hostname: 'acme.com',
      intent: 'help',
      message: 'how do I set up the canonical url?',
      signalsMd: signalsBlock(SIGNALS),
      planMd: 'PLAN MEMO CONTENT',
      history: [
        { role: 'user', content: 'hi' },
        { role: 'agent', content: 'hello — what do you need?' },
      ],
    });
    expect(system).toContain('acme.com');
    // the data must ride in the user prompt so a dropped system_prompt can't blind the model
    expect(user).toContain('LIVE DATA for acme.com');
    expect(user).toContain('42 clicks');
    expect(user).toContain('PLAN MEMO CONTENT');
    expect(user).toContain('Canonical URL setup');
    expect(user).toContain('OWNER: how do I set up the canonical url?');
    expect(user).toContain('YOU: hello — what do you need?');
    expect(user).toContain('never claim you lack access');
  });

  it('omits empty sections', () => {
    const { user } = buildAnswerPrompt({
      hostname: 'acme.com', intent: 'general', message: 'good morning',
      signalsMd: '', planMd: '', history: [],
    });
    expect(user).toContain('brand-new blog');
    expect(user).not.toContain('CURRENT PLAN MEMO');
    expect(user).not.toContain('\nGUIDES\n');
  });

  it('strips old disclaimer turns from the transcript', () => {
    const { user } = buildAnswerPrompt({
      hostname: 'acme.com', intent: 'analytics', message: 'am I getting new users?',
      signalsMd: signalsBlock(SIGNALS), planMd: '',
      history: [
        { role: 'user', content: 'am i getting new users?' },
        { role: 'agent', content: "I don't have direct access to your live analytics dashboard or user database." },
      ],
    });
    expect(user).not.toContain('user database');
    expect(user).toContain('OWNER: am i getting new users?');
  });

  it('forbids claiming actions and defines the proposed_command contract', () => {
    const { system } = buildAnswerPrompt({
      hostname: 'acme.com', intent: 'general', message: 'yes',
      signalsMd: '', planMd: '', history: [],
    });
    expect(system).toContain('WORDS ONLY');
    expect(system).toContain('proposed_command');
  });
});

describe('normalizeAnswer', () => {
  it('reads the canonical {thought, reply} shape', () => {
    expect(normalizeAnswer('{"thought":"t","reply":"the answer"}'))
      .toEqual({ thought: 't', reply: 'the answer' });
  });

  it('accepts the drifted {"message": ...} shape seen in production', () => {
    const raw = JSON.stringify({ message: 'Your top article is **"The 7 Best AI 3D Icon Generators"**.' });
    const a = normalizeAnswer(raw);
    expect(a.reply).toContain('Your top article');
    expect(a.reply).not.toContain('"message"');
  });

  it('accepts other alternate keys and pairs them with a thought alias', () => {
    expect(normalizeAnswer('{"reasoning":"because","answer":"42 clicks"}'))
      .toEqual({ thought: 'because', reply: '42 clicks' });
  });

  it('falls back to the longest string value for unknown shapes — never raw JSON', () => {
    const a = normalizeAnswer('{"foo":"short","bar":"this is the long real answer body"}');
    expect(a.reply).toBe('this is the long real answer body');
  });

  it('treats non-JSON as the reply, stripping stray fences', () => {
    expect(normalizeAnswer('Just a plain answer.').reply).toBe('Just a plain answer.');
    expect(normalizeAnswer('```json\nplain but fenced\n```').reply).toBe('plain but fenced');
  });

  it('carries proposed_command through, exact key only', () => {
    const a = normalizeAnswer('{"thought":"t","reply":"I can queue that.","proposed_command":"write an article about cold brew"}');
    expect(a.proposedCommand).toBe('write an article about cold brew');
    // alternate keys never become an executable command
    expect(normalizeAnswer('{"reply":"hi","command":"drop the plan"}').proposedCommand).toBeUndefined();
  });
});

describe('NO_ACCESS_RX / sanitizeHistory / guardReply', () => {
  const badReplies = [
    "To give you a completely direct answer: I don't know, because I cannot see your data.",
    "Because I am an AI, I don't have access to your website's analytics, Stripe account, or user database.",
    'you will need to check your own analytics dashboard (like Google Analytics, PostHog, or your database)',
    'If you want to look at your numbers and paste them here, I would be happy to help you analyze them!',
  ];

  it('catches every shape of the disclaimer from the real transcript', () => {
    for (const r of badReplies) expect(NO_ACCESS_RX.test(r)).toBe(true);
  });

  it('does not flag honest replies about missing connections', () => {
    expect(NO_ACCESS_RX.test('Google Search Console is NOT connected — connect it on the Analytics page.')).toBe(false);
    expect(NO_ACCESS_RX.test('Yes — 9 readers converted this month, up from 4. Connect GA4 from Dashboard → Analytics for whole-site user counts.')).toBe(false);
  });

  it('sanitizeHistory drops poisoned agent turns, keeps everything else', () => {
    const cleaned = sanitizeHistory([
      { role: 'user', content: 'am i getting new users?' },
      { role: 'agent', content: badReplies[1] },
      { role: 'agent', content: 'You had 9 conversions this month.' },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned[1].content).toContain('9 conversions');
  });

  it('guardReply swaps a disclaimer for the live data and passes good replies through', () => {
    const good = { thought: 't', reply: 'Yes — 9 conversions this month, up from 4.' };
    expect(guardReply(good, 'DATA')).toBe(good);
    const guarded = guardReply({ thought: '', reply: badReplies[0] }, 'FUNNEL: 210 → 120 → 9');
    expect(guarded.reply).toContain('I do have your live data');
    expect(guarded.reply).toContain('FUNNEL: 210 → 120 → 9');
    expect(NO_ACCESS_RX.test(guarded.reply)).toBe(false);
  });

  it('forbids claiming actions and defines the proposed_command contract', () => {
    const { system } = buildAnswerPrompt({
      hostname: 'acme.com', intent: 'general', message: 'yes',
      signalsMd: '', planMd: '', history: [],
    });
    expect(system).toContain('WORDS ONLY');
    expect(system).toContain('proposed_command');
  });
});
