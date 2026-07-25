import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GENERATION_MS,
  GSC_RESERVE_MS,
  MAX_POSTS_PER_TICK,
  TICK_SAFETY_MS,
  capacityReport,
  committedPostsPerMonth,
  estimateGenerationMs,
  generationDurationMs,
  hasRoomFor,
  isStranded,
  lastProgressMs,
  postsPerTick,
  resolveTickBudgetMs,
  schedulerCron,
  schedulerTicksPerDay,
  tickBudgetMs,
  ticksPerDay,
} from '../lib/pipeline/capacity';
import vercelConfig from '../vercel.json';

describe('ticksPerDay', () => {
  it('reads a once-daily schedule as one tick', () => {
    expect(ticksPerDay('0 9 * * *')).toBe(1);
  });

  it('reads hourly and sub-hourly schedules', () => {
    expect(ticksPerDay('0 * * * *')).toBe(24);
    expect(ticksPerDay('*/15 * * * *')).toBe(96);
    expect(ticksPerDay('*/30 * * * *')).toBe(48);
  });

  it('handles lists and ranges', () => {
    expect(ticksPerDay('0 9,17 * * *')).toBe(2);
    expect(ticksPerDay('0 9-17 * * *')).toBe(9);
    expect(ticksPerDay('0,30 9-10 * * *')).toBe(4);
  });

  it('counts ticks on an active day, ignoring day restrictions', () => {
    // The capacity figures are per active day; the scheduler itself runs daily.
    expect(ticksPerDay('0 * * * 1')).toBe(24);
  });

  it('falls back to once daily on anything it cannot parse', () => {
    // Under-promising is the safe direction: a bad parse must never inflate
    // the capacity report and hide an oversold platform.
    expect(ticksPerDay('nonsense')).toBe(1);
    expect(ticksPerDay('0 9 * *')).toBe(1);
    expect(ticksPerDay('*/0 * * * *')).toBe(1);
    expect(ticksPerDay('99 * * * *')).toBe(1);
  });
});

describe('schedulerCron', () => {
  it('reads the live schedule out of vercel.json', () => {
    const configured = (vercelConfig as { crons: { path: string; schedule: string }[] })
      .crons.find((c) => c.path === '/api/cron/scheduler');
    expect(schedulerCron()).toBe(configured!.schedule);
    expect(schedulerTicksPerDay()).toBe(ticksPerDay(configured!.schedule));
  });
});

describe('tickBudgetMs / hasRoomFor', () => {
  it('holds back a safety margin under maxDuration', () => {
    expect(tickBudgetMs(300)).toBe(300_000 - TICK_SAFETY_MS);
  });

  it('never goes negative on a tiny maxDuration', () => {
    expect(tickBudgetMs(5)).toBe(0);
  });

  it('honours a GROVE_TICK_BUDGET_MS override for plans that cap below maxDuration', () => {
    // Hobby kills at 60s however much the route declares.
    expect(resolveTickBudgetMs(300, '60000')).toBe(60_000 - TICK_SAFETY_MS);
  });

  it('falls back to maxDuration when the override is absent or junk', () => {
    const fromMaxDuration = 300_000 - TICK_SAFETY_MS;
    expect(resolveTickBudgetMs(300, undefined)).toBe(fromMaxDuration);
    expect(resolveTickBudgetMs(300, '')).toBe(fromMaxDuration);
    expect(resolveTickBudgetMs(300, 'abc')).toBe(fromMaxDuration);
    expect(resolveTickBudgetMs(300, '0')).toBe(fromMaxDuration);
    expect(resolveTickBudgetMs(300, '-5000')).toBe(fromMaxDuration);
  });

  it('allows work that fits and refuses work that would overrun', () => {
    expect(hasRoomFor(0, 100_000, 90_000)).toBe(true);
    expect(hasRoomFor(20_000, 100_000, 90_000)).toBe(false);
    // exactly filling the budget is allowed
    expect(hasRoomFor(10_000, 100_000, 90_000)).toBe(true);
  });
});

describe('postsPerTick', () => {
  it('fits as many generations as the budget allows after the reserve', () => {
    // 300s budget − 45s reserve = 240s; at 90s each that is 2.
    expect(postsPerTick(300_000, 90_000, GSC_RESERVE_MS)).toBe(2);
  });

  it('scales with a longer budget', () => {
    expect(postsPerTick(900_000, 90_000, GSC_RESERVE_MS)).toBe(9);
  });

  it('returns zero when the reserve eats the whole budget', () => {
    expect(postsPerTick(30_000, 90_000, GSC_RESERVE_MS)).toBe(0);
  });

  it('is capped so a deep backlog cannot make the tick unbounded', () => {
    expect(postsPerTick(10_000_000, 1_000, GSC_RESERVE_MS)).toBe(MAX_POSTS_PER_TICK);
  });
});

describe('generationDurationMs', () => {
  it('measures a run end to end from its log', () => {
    expect(generationDurationMs([{ ts: 1_000 }, { ts: 4_000 }, { ts: 9_000 }])).toBe(8_000);
  });

  it('returns null when there is nothing to measure', () => {
    expect(generationDurationMs([])).toBeNull();
    expect(generationDurationMs(null)).toBeNull();
    expect(generationDurationMs([{ ts: 1_000 }])).toBeNull();
    expect(generationDurationMs([{ ts: 5_000 }, { ts: 5_000 }])).toBeNull();
  });

  it('ignores malformed entries', () => {
    expect(generationDurationMs([{ ts: 1_000 }, null, {}, { ts: 3_000 }])).toBe(2_000);
  });
});

describe('estimateGenerationMs', () => {
  it('falls back when nothing has been measured yet', () => {
    expect(estimateGenerationMs([])).toBe(DEFAULT_GENERATION_MS);
    expect(estimateGenerationMs([0, -5, NaN])).toBe(DEFAULT_GENERATION_MS);
  });

  it('leans pessimistic (p80) so a tick under-fills rather than overruns', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    // p80 sits well above the median — an average would under-estimate and
    // risk a kill mid-article.
    expect(estimateGenerationMs(samples)).toBe(90);
  });

  it('handles a single sample', () => {
    expect(estimateGenerationMs([42])).toBe(42);
  });
});

describe('isStranded / lastProgressMs', () => {
  const now = 1_000_000_000;

  it('reads the newest timestamp as the last progress', () => {
    expect(lastProgressMs([{ ts: 5 }, { ts: 99 }, { ts: 40 }])).toBe(99);
    expect(lastProgressMs([])).toBeNull();
  });

  it('leaves a generation that is still making progress alone', () => {
    expect(isStranded([{ ts: now - 60_000 }], now, 30 * 60_000)).toBe(false);
  });

  it('reclaims one that went quiet past the threshold', () => {
    expect(isStranded([{ ts: now - 31 * 60_000 }], now, 30 * 60_000)).toBe(true);
  });

  it('treats a working post with no timestamps as abandoned', () => {
    // The claim seeds a timestamp, so a live run always has one; a bare log is
    // a leftover from a killed run on an older build.
    expect(isStranded([], now)).toBe(true);
    expect(isStranded(null, now)).toBe(true);
  });
});

describe('committedPostsPerMonth', () => {
  it('sums the quotas of live subscriptions', () => {
    expect(committedPostsPerMonth([
      { plan: 'starter', stripe_status: 'active' },   // 12
      { plan: 'growth', stripe_status: 'trialing' },  // 40
    ])).toBe(52);
  });

  it('ignores subscriptions that are not live', () => {
    expect(committedPostsPerMonth([
      { plan: 'agency', stripe_status: 'canceled' },
      { plan: 'agency', stripe_status: 'past_due' },
      { plan: 'growth', stripe_status: null },
    ])).toBe(0);
  });

  it('ignores rows on an unrecognised plan rather than guessing a quota', () => {
    expect(committedPostsPerMonth([
      { plan: null, stripe_status: 'active' },
      { plan: 'legacy-tier', stripe_status: 'active' },
    ])).toBe(0);
  });
});

describe('capacityReport', () => {
  it('reproduces the ceiling that made this module necessary', () => {
    // The shipped configuration: one tick a day, three posts a tick.
    const r = capacityReport({ ticksPerDay: 1, postsPerTick: 3, committedPerMonth: 150 });
    expect(r.postsPerMonth).toBe(90);
    // A single Agency plan outsold the entire platform.
    expect(r.oversubscribed).toBe(true);
    expect(r.headroomPerMonth).toBe(-60);
  });

  it('clears that same demand once the cron runs hourly', () => {
    const r = capacityReport({ ticksPerDay: 24, postsPerTick: 2, committedPerMonth: 150 });
    expect(r.postsPerMonth).toBe(1440);
    expect(r.oversubscribed).toBe(false);
    expect(r.utilization).toBeCloseTo(150 / 1440, 5);
  });

  it('reports utilization for the tight-capacity warning', () => {
    const r = capacityReport({ ticksPerDay: 1, postsPerTick: 3, committedPerMonth: 72 });
    expect(r.utilization).toBeCloseTo(0.8, 5);
    expect(r.oversubscribed).toBe(false);
  });

  it('treats any demand against zero capacity as oversubscribed', () => {
    const r = capacityReport({ ticksPerDay: 0, postsPerTick: 0, committedPerMonth: 12 });
    expect(r.postsPerMonth).toBe(0);
    expect(r.oversubscribed).toBe(true);
    expect(r.utilization).toBe(Infinity);
  });

  it('is not oversubscribed when nothing has been sold', () => {
    const r = capacityReport({ ticksPerDay: 1, postsPerTick: 0, committedPerMonth: 0 });
    expect(r.oversubscribed).toBe(false);
    expect(r.utilization).toBe(0);
  });
});
