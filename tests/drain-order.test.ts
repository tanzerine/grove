import { describe, it, expect } from 'vitest';
import { pickQueuedFairly, type QueuedPost } from '../lib/pipeline/drain-order';

const p = (id: string, domain: string, t: string): QueuedPost => ({
  id, domain_id: domain, created_at: `2026-07-${t}T09:00:00Z`,
});

describe('pickQueuedFairly', () => {
  it('takes one post per domain before any domain gets seconds', () => {
    const queued = [
      p('a1', 'A', '01'), p('a2', 'A', '02'), p('a3', 'A', '03'),
      p('b1', 'B', '10'),
    ];
    expect(pickQueuedFairly(queued, 3).map((x) => x.id)).toEqual(['a1', 'b1', 'a2']);
  });

  it('orders domains by their oldest queued post', () => {
    const queued = [p('c1', 'C', '05'), p('a1', 'A', '01'), p('b1', 'B', '03')];
    expect(pickQueuedFairly(queued, 2).map((x) => x.id)).toEqual(['a1', 'b1']);
  });

  it('rotates: serving a domain advances its key so skipped domains win next tick', () => {
    const tick1 = [
      p('a1', 'A', '01'), p('b1', 'B', '02'), p('c1', 'C', '03'), p('d1', 'D', '04'),
    ];
    const served = pickQueuedFairly(tick1, 3).map((x) => x.id);
    expect(served).toEqual(['a1', 'b1', 'c1']);
    // next tick: A/B/C's next posts are newer than D's untouched one
    const tick2 = [
      p('a2', 'A', '11'), p('b2', 'B', '12'), p('c2', 'C', '13'), p('d1', 'D', '04'),
    ];
    expect(pickQueuedFairly(tick2, 3).map((x) => x.id)).toEqual(['d1', 'a2', 'b2']);
  });

  it('gives a single-domain install the full budget', () => {
    const queued = [p('a3', 'A', '03'), p('a1', 'A', '01'), p('a2', 'A', '02')];
    expect(pickQueuedFairly(queued, 3).map((x) => x.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('stops at the limit', () => {
    const queued = [p('a1', 'A', '01'), p('b1', 'B', '02'), p('c1', 'C', '03')];
    expect(pickQueuedFairly(queued, 2)).toHaveLength(2);
  });

  it('handles empty input and zero limit', () => {
    expect(pickQueuedFairly([], 3)).toEqual([]);
    expect(pickQueuedFairly([p('a1', 'A', '01')], 0)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const queued = [p('b1', 'B', '02'), p('a1', 'A', '01')];
    const copy = [...queued];
    pickQueuedFairly(queued, 2);
    expect(queued).toEqual(copy);
  });
});
