/**
 * Every surface must agree on how many posts are in what state.
 *
 * Five places computed this independently and disagreed. The nav badge summed
 * every non-terminal post across ALL of an owner's domains, so an account with
 * one site holding 1 draft for review and another holding 15 queued saw "16" in
 * the nav while the pipeline page for the site they were looking at said
 * "1 waiting on you".
 */
import { describe, it, expect } from 'vitest';
import {
  pipelineCounts,
  isStuck,
  STUCK_AFTER_MIN,
  WORKING,
} from '../lib/pipeline/counts';

const NOW = Date.parse('2026-07-26T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const fresh = (status: string) => ({ status, created_at: minutesAgo(0) });

describe('pipelineCounts', () => {
  it('sorts each status into exactly one bucket', () => {
    const c = pipelineCounts([
      fresh('queued'), fresh('researching'), fresh('writing'),
      fresh('review'), fresh('review'),
      fresh('scheduled'),
      fresh('published'), fresh('published'), fresh('published'),
      fresh('failed'),
    ], NOW);

    expect(c.inFlight).toBe(3);
    expect(c.needsReview).toBe(2);
    expect(c.scheduled).toBe(1);
    expect(c.published).toBe(3);
    expect(c.failed).toBe(1);
  });

  it('counts only what needs the owner personally', () => {
    // The agent working is progress, not a to-do. This is the whole point of
    // the badge: queued and scheduled posts must not raise an alarm.
    const c = pipelineCounts([
      fresh('queued'), fresh('queued'), fresh('scheduled'), fresh('published'),
      fresh('review'), fresh('failed'),
    ], NOW);

    expect(c.needsYou).toBe(2);           // review + failed
    expect(c.inFlight).toBe(2);
  });

  it('raises no alarm when the agent is simply busy', () => {
    const c = pipelineCounts([fresh('queued'), fresh('writing'), fresh('scheduled')], NOW);
    expect(c.needsYou).toBe(0);
  });

  it('treats a stranded run as needing attention, not as in flight', () => {
    const stranded = { status: 'writing', created_at: minutesAgo(STUCK_AFTER_MIN + 1) };
    const c = pipelineCounts([stranded], NOW);

    expect(c.inFlight).toBe(0);
    expect(c.failed).toBe(1);
    expect(c.needsYou).toBe(1);
  });

  it('leaves a healthy in-progress run alone', () => {
    const running = { status: 'writing', created_at: minutesAgo(STUCK_AFTER_MIN - 1) };
    const c = pipelineCounts([running], NOW);

    expect(c.inFlight).toBe(1);
    expect(c.needsYou).toBe(0);
  });

  it('ignores statuses it has no bucket for rather than mis-filing them', () => {
    const c = pipelineCounts([fresh('archived'), fresh('some_future_status')], NOW);
    expect(c.inFlight + c.needsReview + c.scheduled + c.published + c.failed).toBe(0);
  });

  it('handles null, undefined, empty and malformed input', () => {
    expect(pipelineCounts(null, NOW).needsYou).toBe(0);
    expect(pipelineCounts(undefined, NOW).needsYou).toBe(0);
    expect(pipelineCounts([], NOW).needsYou).toBe(0);
    expect(pipelineCounts([{}, { status: null }, { status: 'review', created_at: 'not-a-date' }], NOW).needsReview).toBe(1);
  });

  it('reproduces the disagreement that motivated this', () => {
    // Site A: 1 draft awaiting review. Site B: 7 review + 8 queued.
    const siteA = [fresh('review'), ...Array.from({ length: 35 }, () => fresh('published'))];
    const siteB = [
      ...Array.from({ length: 7 }, () => fresh('review')),
      ...Array.from({ length: 8 }, () => fresh('queued')),
    ];

    // The badge is per-site and only counts what needs you. Looking at site A
    // it reads 1 — matching what the pipeline page for site A says.
    expect(pipelineCounts(siteA, NOW).needsYou).toBe(1);

    // The old badge summed every non-terminal post across BOTH sites: 16.
    const oldBadge = [...siteA, ...siteB]
      .filter((p) => !['published', 'failed', 'archived'].includes(p.status)).length;
    expect(oldBadge).toBe(16);
    expect(pipelineCounts(siteA, NOW).needsYou).not.toBe(oldBadge);
  });
});

describe('isStuck', () => {
  it('applies only to statuses where the agent holds the post', () => {
    for (const status of WORKING) {
      expect(isStuck({ status, created_at: minutesAgo(STUCK_AFTER_MIN + 1) }, NOW)).toBe(true);
    }
    // A draft waiting on a human is not stuck, however long it waits.
    expect(isStuck({ status: 'review', created_at: minutesAgo(60 * 24 * 7) }, NOW)).toBe(false);
    expect(isStuck({ status: 'scheduled', created_at: minutesAgo(60 * 24 * 7) }, NOW)).toBe(false);
  });

  it('needs a usable timestamp to call anything stuck', () => {
    expect(isStuck({ status: 'writing' }, NOW)).toBe(false);
    expect(isStuck({ status: 'writing', created_at: null }, NOW)).toBe(false);
    expect(isStuck({ status: 'writing', created_at: 'nonsense' }, NOW)).toBe(false);
  });
});
