import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GENERATION_MS,
  GSC_RESERVE_MS,
  GSC_SYNC_HOUR_UTC,
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
  shouldSyncGsc,
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

  it('is configured for enough ticks to serve the top plan', () => {
    // The whole point of the capacity work: one Agency subscription sells 150
    // posts/month, which a once-daily tick could never deliver. Guard the
    // schedule itself so a revert to daily fails here rather than in support.
    expect(schedulerTicksPerDay()).toBeGreaterThanOrEqual(24);
  });

  it('keeps the two hourly crons off the same minute', () => {
    // Both are 300s functions; firing them together doubles peak load for no
    // reason. Offsetting them is deliberate, so assert it.
    const crons = (vercelConfig as { crons: { path: string; schedule: string }[] }).crons;
    const minuteOf = (p: string) => crons.find((c) => c.path === p)!.schedule.split(' ')[0];
    expect(minuteOf('/api/cron/scheduler')).not.toBe(minuteOf('/api/cron/images'));
  });
});

describe('shouldSyncGsc', () => {
  const at = (hour: number) => new Date(Date.UTC(2026, 6, 26, hour, 0, 0));

  it('syncs on one tick a day when the cron is sub-daily', () => {
    expect(shouldSyncGsc(at(GSC_SYNC_HOUR_UTC), 24)).toBe(true);
    expect(shouldSyncGsc(at(GSC_SYNC_HOUR_UTC + 1), 24)).toBe(false);
    expect(shouldSyncGsc(at(0), 24)).toBe(false);
  });

  it('always syncs when there is only one tick in the day', () => {
    // A daily cron may land on any hour; gating it by hour would mean the
    // feedback signal simply never refreshes.
    expect(shouldSyncGsc(at(9), 1)).toBe(true);
    expect(shouldSyncGsc(at(23), 1)).toBe(true);
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
  const t = (s: number) => 1_700_000_000_000 + s * 1_000;

  it('measures a run end to end over its pipeline steps', () => {
    expect(generationDurationMs([
      { ts: t(0), step: 'queued' },
      { ts: t(12), step: 'research' },
      { ts: t(149), step: 'persist' },
    ])).toBe(149_000);
  });

  it('ignores image backfill appended days later', () => {
    // Regression: /api/cron/images keeps appending cover_image / inline_images
    // entries for days, so first-to-last measured the AGE of the post (~6 days
    // in production), not its cost. The estimate blew past the tick budget and
    // the drain stopped starting any work at all.
    const log = [
      { ts: t(0), step: 'queued' },
      { ts: t(33), step: 'writer' },
      { ts: t(149), step: 'persist' },
      { ts: t(62_492), step: 'cover_image' },      // next day
      { ts: t(148_000), step: 'inline_images' },   // two days later
      { ts: t(520_000), step: 'inline_images' },   // six days later
    ];
    expect(generationDurationMs(log)).toBe(149_000);
  });

  it('discards an implausibly long sample rather than trusting it', () => {
    expect(generationDurationMs([
      { ts: t(0), step: 'queued' },
      { ts: t(60 * 60), step: 'persist' }, // an hour of "pipeline" is not real
    ])).toBeNull();
  });

  it('returns null when there is nothing to measure', () => {
    expect(generationDurationMs([])).toBeNull();
    expect(generationDurationMs(null)).toBeNull();
    expect(generationDurationMs([{ ts: t(0), step: 'queued' }])).toBeNull();
    expect(generationDurationMs([{ ts: t(5), step: 'queued' }, { ts: t(5), step: 'persist' }])).toBeNull();
  });

  it('ignores malformed and unrecognised entries', () => {
    expect(generationDurationMs([
      { ts: t(0), step: 'queued' },
      null,
      {},
      { ts: t(9) },                       // no step — not a known pipeline entry
      { ts: t(3), step: 'persist' },
    ])).toBe(3_000);
  });
});

describe('drain sizing against real measurements', () => {
  // Measured over 33 production generations: p80 138s, avg 117s, max 157s.
  const OBSERVED_P80_MS = 138_000;

  it('fits more articles on the ticks that skip the Search Console sync', () => {
    const budget = tickBudgetMs(300);
    // The one daily sync tick holds 45s back...
    expect(postsPerTick(budget, OBSERVED_P80_MS, GSC_RESERVE_MS)).toBe(1);
    // ...the other 23 spend the whole invocation on generation.
    expect(postsPerTick(budget, OBSERVED_P80_MS, 0)).toBe(2);
  });

  it('clears the top plan with room to spare on the hourly schedule', () => {
    // 23 generation-only ticks at 2 + 1 sync tick at 1 = 47/day.
    const perDay = 23 * 2 + 1;
    const r = capacityReport({ ticksPerDay: perDay, postsPerTick: 1, committedPerMonth: 150 });
    expect(r.postsPerMonth).toBe(1410);
    expect(r.oversubscribed).toBe(false);
    // The ceiling that started all this was 90/month — less than one Agency plan.
    expect(r.postsPerMonth).toBeGreaterThan(90 * 15);
  });

  it('never sizes a tick to zero work from a poisoned estimate', () => {
    // Even if a sample slips through, the scheduler always attempts its first
    // candidate; this asserts the estimate itself can no longer be day-scale.
    const sixDays = 6 * 24 * 3_600_000;
    expect(estimateGenerationMs([sixDays].filter((n) => n <= 20 * 60_000))).toBe(DEFAULT_GENERATION_MS);
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
