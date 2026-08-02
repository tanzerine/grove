import { describe, it, expect } from 'vitest';
import { unmaterializedSlots } from '../lib/strategy/materialize';
import type { PostSlot } from '../lib/strategy/build';

const slot = (id: string, publish_date: string | undefined, topic = `topic ${id}`): PostSlot =>
  ({ id, topic, publish_date } as PostSlot);

describe('unmaterializedSlots', () => {
  it('keeps the slots that have not become posts yet', () => {
    const plan = [
      slot('a', '2026-08-03T09:00:00.000Z'),
      slot('b', '2026-08-05T09:00:00.000Z'),
      slot('c', '2026-08-07T09:00:00.000Z'),
    ];
    expect(unmaterializedSlots(plan, ['b']).map((s) => s.id)).toEqual(['a', 'c']);
  });

  // THE DASHBOARD BUG. Slots materialize only ~72h before their date, so early
  // in a month almost the entire calendar exists only in the plan. The home
  // card drew from posts alone and showed a near-empty month — reading as "the
  // agent has nothing planned" — while the calendar page showed all 20.
  it('returns the whole month when nothing has materialized yet', () => {
    const plan = Array.from({ length: 20 }, (_, i) =>
      slot(`s${i}`, `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00.000Z`));
    expect(unmaterializedSlots(plan, [])).toHaveLength(20);
  });

  it('ignores nulls and undefined in the materialized id list', () => {
    const plan = [slot('a', '2026-08-03T09:00:00.000Z'), slot('b', '2026-08-05T09:00:00.000Z')];
    // posts.slot_id is nullable — manually written posts carry no slot.
    expect(unmaterializedSlots(plan, [null, undefined, 'a']).map((s) => s.id)).toEqual(['b']);
  });

  it('drops slots with no publish_date — they cannot be placed on a grid', () => {
    const plan = [slot('a', undefined), slot('b', '2026-08-05T09:00:00.000Z')];
    expect(unmaterializedSlots(plan, []).map((s) => s.id)).toEqual(['b']);
  });

  it('handles a missing or empty plan', () => {
    expect(unmaterializedSlots(null, [])).toEqual([]);
    expect(unmaterializedSlots(undefined, ['a'])).toEqual([]);
    expect(unmaterializedSlots([], ['a'])).toEqual([]);
  });

  it('returns nothing once every slot has a post', () => {
    const plan = [slot('a', '2026-08-03T09:00:00.000Z'), slot('b', '2026-08-05T09:00:00.000Z')];
    expect(unmaterializedSlots(plan, ['a', 'b'])).toEqual([]);
  });
});
