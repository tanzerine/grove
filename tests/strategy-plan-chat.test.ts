import { describe, it, expect } from 'vitest';
import { classifyPlanMessage, mergeRevision, PLAN_CHAT_LIMITS } from '../lib/strategy/plan-chat';
import type { Strategy, PostSlot } from '../lib/strategy/build';

const slot = (id: string, topic: string, publish_date?: string): PostSlot => ({
  id, pillar_id: 'p1', goal_id: 'g1', kpi_id: 'k1', topic, intent: 'contextual', publish_date,
});

const base = (plan: PostSlot[]): Strategy => ({
  month: '2026-07',
  source: 'mixed',
  goals: [{ id: 'g1', title: 'Grow signups', why: 'revenue' }],
  kpis: [{ id: 'k1', goal_id: 'g1', metric: 'conversions', target: 10 }],
  pillars: [{ id: 'p1', title: 'Tokens', intent_mix: { editorial: 0.3, contextual: 0.5, conversion: 0.2 }, audience: 'designers', promise: 'ship faster' }],
  publishing_plan: plan,
  notes: '',
});

describe('classifyPlanMessage', () => {
  it('routes steering verbs to the revision path', () => {
    expect(classifyPlanMessage('add two more conversion posts')).toBe('revision');
    expect(classifyPlanMessage('can you replace the tokens post with pricing content')).toBe('revision');
    expect(classifyPlanMessage('focus more on SEO this month')).toBe('revision');
    expect(classifyPlanMessage('전환 글 더 추가해줘')).toBe('revision');
  });

  it('interrogative openers win even when they contain steering verbs', () => {
    expect(classifyPlanMessage('why did you add the pricing post?')).toBe('question');
    expect(classifyPlanMessage('What should we focus on this week?')).toBe('question');
    expect(classifyPlanMessage('어떻게 진행되고 있어?')).toBe('question');
  });

  it('defaults to the cheap question path', () => {
    expect(classifyPlanMessage('tell me about this week')).toBe('question');
  });
});

describe('mergeRevision', () => {
  const d1 = '2026-07-02T09:00:00.000Z';
  const d2 = '2026-07-16T09:00:00.000Z';

  it('kept slots inherit their original publish_date when the model drops it', () => {
    const current = base([slot('s1', 'Intro', d1), slot('s2', 'Deep dive', d2)]);
    const proposed = base([slot('s1', 'Intro'), slot('s2', 'Deep dive'), slot('s3', 'New pricing post')]);
    const out = mergeRevision(current, proposed, { postsPerWeek: 2 });
    const byId = new Map(out.publishing_plan.map((s) => [s.id, s]));
    expect(byId.get('s1')?.publish_date).toBe(d1);
    expect(byId.get('s2')?.publish_date).toBe(d2);
    expect(byId.get('s3')?.publish_date).toBeTruthy();          // scheduler dated the new slot
  });

  it('restores locked slots the model removed', () => {
    const current = base([slot('s1', 'Already drafted', d1), slot('s2', 'Future', d2)]);
    const proposed = base([slot('s2', 'Future', d2)]);
    const out = mergeRevision(current, proposed, { postsPerWeek: 2, lockedSlotIds: ['s1'] });
    expect(out.publishing_plan.some((s) => s.id === 's1' && s.publish_date === d1)).toBe(true);
  });

  it('caps the slot count at 2x the plan quota — chat cannot double spend silently', () => {
    const current = base([slot('s1', 'A', d1)]);
    const proposed = base(Array.from({ length: 12 }, (_, i) => slot(`n${i}`, `Extra ${i}`)));
    const out = mergeRevision(current, proposed, { postsPerWeek: 1 });  // quota 4 → cap 8
    expect(out.publishing_plan.length).toBe(8);
  });

  it('marks the result revised and pins the original month', () => {
    const current = base([slot('s1', 'A', d1)]);
    const proposed = { ...base([slot('s1', 'A', d1)]), month: '2026-09' };
    const out = mergeRevision(current, proposed, { postsPerWeek: 2 });
    expect(out.source).toBe('revised');
    expect(out.month).toBe('2026-07');
  });

  it('runs the shared guardrails — dangling refs are repaired', () => {
    const current = base([slot('s1', 'A', d1)]);
    const proposed = base([{ ...slot('s2', 'B'), pillar_id: 'ghost', goal_id: 'ghost', kpi_id: 'ghost' }]);
    const out = mergeRevision(current, proposed, { postsPerWeek: 2 });
    expect(out.publishing_plan[0].pillar_id).toBe('p1');
    expect(out.publishing_plan[0].goal_id).toBe('g1');
    expect(out.publishing_plan[0].kpi_id).toBe('k1');
  });
});

describe('PLAN_CHAT_LIMITS', () => {
  it('keeps the expensive path bounded', () => {
    // ~8 strategist calls/month ≈ a few dollars per domain — the BM guardrail.
    expect(PLAN_CHAT_LIMITS.revisionsPerMonth).toBeLessThanOrEqual(10);
    expect(PLAN_CHAT_LIMITS.messagesPerMonth).toBeLessThanOrEqual(60);
  });
});
