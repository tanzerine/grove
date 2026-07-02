import { describe, it, expect } from 'vitest';
import {
  composePlanMd,
  progressEntry,
  appendProgress,
  horizons,
  contextForPrompt,
  MAX_PROGRESS_ENTRIES,
} from '../lib/strategy/context';
import type { Strategy } from '../lib/strategy/build';

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  month: '2026-07',
  source: 'mixed',
  goals: [{ id: 'g1', title: 'Grow trial signups', why: 'revenue depends on it' }],
  kpis: [{ id: 'k1', goal_id: 'g1', metric: 'conversions', target: 20 }],
  pillars: [{
    id: 'p1', title: 'Design tokens',
    intent_mix: { editorial: 0.3, contextual: 0.5, conversion: 0.2 },
    audience: 'designers', promise: 'ship faster with tokens',
  }],
  publishing_plan: [
    { id: 's1', pillar_id: 'p1', goal_id: 'g1', kpi_id: 'k1', topic: 'Intro to tokens', intent: 'editorial', publish_date: '2026-07-01T09:00:00.000Z' },
    { id: 's2', pillar_id: 'p1', goal_id: 'g1', kpi_id: 'k1', topic: 'Tokens in Figma', intent: 'contextual', publish_date: '2026-07-08T09:00:00.000Z', target_keyword: 'figma tokens' },
    { id: 's3', pillar_id: 'p1', goal_id: 'g1', kpi_id: 'k1', topic: 'Tokens pricing pitch', intent: 'conversion', publish_date: '2026-07-21T09:00:00.000Z' },
  ],
  direction: { month: 'Turn token authority into 20 signups.', weeks: ['Lay the foundations', 'Cover Figma demand', 'Convert readers', 'Refresh winners'] },
  notes: 'doubling down on tokens',
  ...over,
});

describe('composePlanMd', () => {
  it('renders a compact memo with goals, pillars, weeks and dated slots', () => {
    const md = composePlanMd(strategy(), { hostname: 'acme.com' });
    expect(md).toContain('# Plan — acme.com — 2026-07');
    expect(md).toContain('Heading: Turn token authority into 20 signups.');
    expect(md).toContain('- Grow trial signups → 20 conversions');
    expect(md).toContain('- Design tokens — ship faster with tokens');
    expect(md).toContain('- W2: Cover Figma demand');
    expect(md).toContain('- 07-08 [contextual] Tokens in Figma (kw: figma tokens)');
  });

  it('stays token-lean: a full plan fits well under ~4KB', () => {
    const big = strategy({
      publishing_plan: Array.from({ length: 60 }, (_, i) => ({
        id: `s${i}`, pillar_id: 'p1', goal_id: 'g1', kpi_id: 'k1',
        topic: `Some fairly long article topic number ${i} about design tokens`,
        intent: 'contextual' as const, publish_date: '2026-07-08T09:00:00.000Z',
      })),
    });
    const md = composePlanMd(big, { hostname: 'acme.com' });
    expect(md.length).toBeLessThan(4000);
    // slot list is capped, not truncated mid-line
    expect(md).toContain('SLOTS (60)');
  });

  it('omits sections that have no content', () => {
    const md = composePlanMd(strategy({ goals: [], pillars: [], direction: undefined, notes: '' }), { hostname: 'a.co' });
    expect(md).not.toContain('GOALS');
    expect(md).not.toContain('PILLARS');
    expect(md).not.toContain('WEEK BY WEEK');
  });
});

describe('progressEntry + appendProgress', () => {
  const entry = (weekOf: string, reads = 120) => progressEntry({
    weekOf, published: 3, planned: 4, reads, readsPrev: 90,
    conversions: 4, organicShare: 0.22, topPost: { title: 'Intro to tokens', views: 45 },
  });

  it('is two-to-three compact lines with the trend baked in', () => {
    const e = entry('2026-06-29');
    expect(e).toContain('### Week of 2026-06-29');
    expect(e).toContain('shipped 3/4 planned · 120 reads (+33% wow) · 4 conversions · 22% from search');
    expect(e).toContain('top: "Intro to tokens" (45 reads)');
    expect(e.split('\n').length).toBeLessThanOrEqual(3);
  });

  it('marks the first readers instead of a bogus percentage', () => {
    const e = progressEntry({ weekOf: '2026-06-01', published: 1, planned: 1, reads: 10, readsPrev: 0, conversions: 0, organicShare: 0 });
    expect(e).toContain('(first reads)');
  });

  it('appends chronologically and trims the oldest past the cap', () => {
    let log = '';
    for (let i = 0; i < MAX_PROGRESS_ENTRIES + 3; i++) {
      log = appendProgress(log, entry(`2026-01-${String(i + 1).padStart(2, '0')}`));
    }
    const entries = log.split(/\n(?=### )/);
    expect(entries.length).toBe(MAX_PROGRESS_ENTRIES);
    expect(entries[0]).toContain('2026-01-04');                 // oldest three dropped
    expect(entries[entries.length - 1]).toContain('2026-01-15'); // newest last
  });
});

describe('horizons', () => {
  it('answers month, week, and today from the plan', () => {
    // Wed 2026-07-08 — s2 publishes that day
    const hz = horizons(strategy(), new Date('2026-07-08T14:00:00Z'));
    expect(hz.month.headline).toBe('Turn token authority into 20 signups.');
    expect(hz.month.detail).toContain('3 posts planned');
    expect(hz.week.headline).toBe('Cover Figma demand');       // week 2 narrative
    expect(hz.week.slots.map((s) => s.topic)).toEqual(['Tokens in Figma']);
    expect(hz.today.headline).toContain('Publishing today: Tokens in Figma');
  });

  it('points at the next slot when nothing publishes today', () => {
    const hz = horizons(strategy(), new Date('2026-07-15T10:00:00Z'));
    expect(hz.today.headline).toContain('Next up in 6 days: Tokens pricing pitch');
  });

  it('reports plan completion once everything is live', () => {
    const hz = horizons(strategy(), new Date('2026-07-30T10:00:00Z'));
    expect(hz.today.headline).toBe('All planned posts are live');
  });

  it('falls back to computed headlines when direction is missing', () => {
    const hz = horizons(strategy({ direction: undefined }), new Date('2026-07-08T10:00:00Z'));
    expect(hz.month.headline).toBe('Grow trial signups');
    expect(hz.week.headline).toContain('1 post going live this week');
  });
});

describe('contextForPrompt', () => {
  it('keeps the plan whole and trims progress from the oldest end', () => {
    const plan = 'PLAN'.repeat(100);          // 400 chars
    const progress = 'x'.repeat(10_000);
    const out = contextForPrompt(plan, progress, 1000);
    expect(out.startsWith(plan)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1000 + 60); // + section header
  });
});
