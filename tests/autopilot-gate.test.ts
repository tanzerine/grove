import { describe, it, expect } from 'vitest';
import { canEnableAutopilot, REVIEWABLE_STATUSES } from '../lib/autopilot-gate';

describe('canEnableAutopilot', () => {
  it('refuses a brand-new domain that has never produced a draft', () => {
    // The whole point: nothing stopped a day-one account arming autopilot from
    // the nav pill before grove had shown it a single sentence it writes.
    const gate = canEnableAutopilot({ finishedDrafts: 0 });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/finished draft/i);
  });

  it('allows it once one finished draft exists', () => {
    expect(canEnableAutopilot({ finishedDrafts: 1 })).toEqual({ allowed: true });
  });

  it('allows it with a backlog', () => {
    expect(canEnableAutopilot({ finishedDrafts: 40 }).allowed).toBe(true);
  });

  it('gives the owner a reason they can act on, not an error code', () => {
    const { reason } = canEnableAutopilot({ finishedDrafts: 0 });
    expect(reason).toBeTruthy();
    expect(reason!.length).toBeGreaterThan(40);
    expect(reason).toMatch(/review/i);
  });
});

describe('REVIEWABLE_STATUSES', () => {
  it('counts only statuses whose draft the owner can actually open', () => {
    expect([...REVIEWABLE_STATUSES].sort()).toEqual(['published', 'review', 'scheduled']);
  });

  it('excludes working and dead-end statuses', () => {
    // A post mid-research is not something anyone can judge, and a failed one
    // shows nothing at all — neither should unlock autopilot.
    for (const s of ['queued', 'researching', 'writing', 'failed', 'archived']) {
      expect(REVIEWABLE_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});
