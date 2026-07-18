import { describe, it, expect } from 'vitest';
import { parseSlash, classifyIntent, writeTopicFrom } from '../lib/assistant/triage';
import { relevantKnowledge } from '../lib/assistant/knowledge';
import { signalsBlock, type AssistantSignals } from '../lib/assistant/context';
import { buildAnswerPrompt } from '../lib/assistant/chat';

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

  it('falls back to general', () => {
    expect(classifyIntent('good morning!')).toBe('general');
  });

  it('handles Korean phrasing', () => {
    expect(classifyIntent('이번 달 트래픽이 왜 이래?')).toBe('analytics');
    expect(classifyIntent('커피 원두 보관에 대한 글 써줘')).toBe('write');
    expect(classifyIntent('커스텀 도메인 설정 어떻게 해?')).toBe('help');
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

const SIGNALS: AssistantSignals = {
  brief: {
    hostname: 'acme.com', publishedThisWeek: 2, totalPublished: 14,
    readsThisWeek: 120, readsLastWeek: 90, conversionsThisWeek: 5,
    organicShare: 0.4, inReview: 1, inFlight: 2,
    nextScheduledAt: '2026-07-20T09:00:00Z',
    topPost: { title: 'Hello', views: 40 },
  },
  month: {
    views: 300, prevViews: 500, conversions: 9, organicShare: 0.35,
    topPosts: [{ title: 'Best post', views: 80 }],
  },
  gsc: { clicks: 42, impressions: 2100, ctr: 0.02, avgPosition: 18.4 },
  setup: {
    gscConnected: true, ga4Connected: false, canonicalBase: null,
    customHostname: null, autoPublish: true, postsPerWeek: 4,
  },
};

describe('signalsBlock', () => {
  it('renders every section with the real numbers', () => {
    const md = signalsBlock(SIGNALS);
    expect(md).toContain('14 total');
    expect(md).toContain('300 reads (previous month total 500)');
    expect(md).toContain('42 clicks from 2100 impressions (CTR 2%)');
    expect(md).toContain('Next scheduled publish: 2026-07-20');
    expect(md).toContain('canonical base not set');
    expect(md).toContain('autopilot ON');
  });

  it('says GSC is missing instead of inventing zeros', () => {
    const md = signalsBlock({
      ...SIGNALS, gsc: null,
      setup: { ...SIGNALS.setup, gscConnected: false },
    });
    expect(md).toContain('NOT connected');
  });
});

describe('buildAnswerPrompt', () => {
  it('embeds signals, plan memo, matching guides and the transcript', () => {
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
    expect(system).toContain('42 clicks');
    expect(system).toContain('PLAN MEMO CONTENT');
    expect(system).toContain('Canonical URL setup');
    expect(user).toContain('OWNER: how do I set up the canonical url?');
    expect(user).toContain('YOU: hello — what do you need?');
  });

  it('omits empty sections', () => {
    const { system } = buildAnswerPrompt({
      hostname: 'acme.com', intent: 'general', message: 'good morning',
      signalsMd: '', planMd: '', history: [],
    });
    expect(system).toContain('(no data yet)');
    expect(system).not.toContain('CURRENT PLAN MEMO');
    expect(system).not.toContain('\nGUIDES\n');
  });
});
