import { describe, it, expect } from 'vitest';
import { strategyBrief } from '../lib/strategy/brief';
import type { Strategy, PostSlot, Pillar } from '../lib/strategy/build';

const pillar = (id: string, title: string): Pillar => ({
  id, title,
  intent_mix: { editorial: 0.5, contextual: 0.3, conversion: 0.2 },
  audience: 'founders', promise: 'ship faster',
});

const slot = (id: string, pillar_id: string, intent: PostSlot['intent']): PostSlot => ({
  id, pillar_id, intent, topic: `topic ${id}`,
} as PostSlot);

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  goals: [], kpis: [], pillars: [], publishing_plan: [], ...over,
} as unknown as Strategy);

describe('strategyBrief', () => {
  it('leads with the pillar carrying the most slots and counts converting posts', () => {
    const out = strategyBrief(strategy({
      pillars: [pillar('a', 'Automation guides'), pillar('b', 'Pricing')],
      publishing_plan: [
        slot('1', 'a', 'editorial'), slot('2', 'a', 'contextual'), slot('3', 'a', 'editorial'),
        slot('4', 'b', 'conversion'), slot('5', 'b', 'conversion'),
      ],
    }));
    expect(out.headline).toBe('Own Automation guides — 5 posts, 2 built to convert.');
    expect(out.summary).toBe('2 pillars · 2 top-funnel · 1 mid-funnel · 2 conversion');
  });

  it('drops the convert clause when nothing is conversion-intent', () => {
    const out = strategyBrief(strategy({
      pillars: [pillar('a', 'Automation guides')],
      publishing_plan: [slot('1', 'a', 'editorial'), slot('2', 'a', 'contextual')],
    }));
    expect(out.headline).toBe('Own Automation guides — 2 posts building search authority.');
  });

  it('falls back to a plain ship line when slots have no matching pillar', () => {
    const out = strategyBrief(strategy({
      pillars: [], publishing_plan: [slot('1', 'ghost', 'editorial')],
    }));
    expect(out.headline).toBe('Ship 1 post and prove the channel.');
  });

  it('handles an empty plan', () => {
    const out = strategyBrief(strategy());
    expect(out.headline).toMatch(/still being drafted/);
    expect(out.summary).toMatch(/as soon as the strategist/);
    expect(out.note).toBeUndefined();
  });

  it('trims the strategist note to its first sentence', () => {
    const out = strategyBrief(strategy({
      pillars: [pillar('a', 'Automation guides')],
      publishing_plan: [slot('1', 'a', 'conversion')],
      notes: 'Doubling down on conversion content. Last month top-funnel reads grew 40% but nothing converted, so the mix shifts.',
    } as Partial<Strategy>));
    expect(out.note).toBe('Doubling down on conversion content.');
  });

  it('keeps the headline short even with a verbose pillar title', () => {
    const out = strategyBrief(strategy({
      pillars: [pillar('a', 'A very long winded pillar title about everything under the sun and more')],
      publishing_plan: [slot('1', 'a', 'editorial')],
    }));
    expect(out.headline.length).toBeLessThan(110);
    expect(out.headline).toContain('…');
  });
});
