import { describe, it, expect } from 'vitest';
import {
  UNIQUE_VIOLATION,
  classifyClaim,
  isDuplicate,
  shouldReleaseClaim,
} from '../lib/stripe-idempotency';

describe('classifyClaim', () => {
  it('treats a clean insert as ours to own', () => {
    expect(classifyClaim(null)).toBe('claimed');
    expect(classifyClaim(undefined)).toBe('claimed');
  });

  it('treats a unique violation as an already-handled duplicate', () => {
    expect(classifyClaim({ code: UNIQUE_VIOLATION })).toBe('duplicate');
  });

  it('treats any other insert error as unclaimed', () => {
    // e.g. the table does not exist yet — the webhook still processes the
    // event (dropping real billing events is worse than a double-apply), but
    // it must not later delete a row it never wrote.
    expect(classifyClaim({ code: '42P01' })).toBe('unclaimed');
    expect(classifyClaim({})).toBe('unclaimed');
  });
});

describe('isDuplicate', () => {
  it('short-circuits only true duplicates', () => {
    expect(isDuplicate('duplicate')).toBe(true);
    expect(isDuplicate('claimed')).toBe(false);
    expect(isDuplicate('unclaimed')).toBe(false);
  });
});

describe('shouldReleaseClaim', () => {
  it('releases the row we inserted, so Stripe’s retry can run', () => {
    // The regression this whole module exists for: without the release, a
    // transient handler failure returns 500, Stripe redelivers, the insert
    // hits 23505 and the retry short-circuits as a duplicate having never
    // processed the event — customer paid, no access, unrecoverable.
    expect(shouldReleaseClaim('claimed')).toBe(true);
  });

  it('never deletes a row we did not write', () => {
    // Deleting on 'duplicate' would un-guard an event another invocation is
    // processing right now; deleting on 'unclaimed' would remove someone
    // else's row entirely.
    expect(shouldReleaseClaim('duplicate')).toBe(false);
    expect(shouldReleaseClaim('unclaimed')).toBe(false);
  });

  it('is the exact complement of a successful insert', () => {
    // Guards the invariant directly: release iff we were the inserter.
    for (const err of [null, { code: UNIQUE_VIOLATION }, { code: '42P01' }]) {
      const state = classifyClaim(err as any);
      expect(shouldReleaseClaim(state)).toBe(err === null);
    }
  });
});
