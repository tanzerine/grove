/**
 * What the planner actually PUTS ON SCREEN.
 *
 * The arithmetic is covered in operator-plan.test.ts; this pins the wiring
 * between it and the board, which is where the interesting mistakes live: a
 * roll-up badge reading the wrong item's progress, or a column showing a
 * period label that disagrees with the rows underneath it. Both render
 * perfectly and are wrong, and neither is visible from a unit test of the
 * pure functions.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PlanAdmin from '@/app/dashboard/admin/plan/PlanAdmin';
import type { PlanBoard, PlanItem } from '@/lib/operator-plan-store';

const TODAY = '2026-09-04'; // a Friday, in ISO week 2026-W36

function item(over: Partial<PlanItem> & { id: string; horizon: PlanItem['horizon']; period_key: string; title: string }): PlanItem {
  return {
    notes: null, status: 'todo', parent_id: null, sort: 0, done_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const GOAL = item({ id: 'g1', horizon: 'month', period_key: '2026-09', title: 'Ship the MCP docs' });
const FOCUS = item({ id: 'w1', horizon: 'week', period_key: '2026-W36', title: 'Draft the integration guide', parent_id: 'g1' });
const DONE_TASK = item({ id: 'd1', horizon: 'day', period_key: TODAY, title: 'Outline the guide', parent_id: 'w1', status: 'done' });
const OPEN_TASK = item({ id: 'd2', horizon: 'day', period_key: TODAY, title: 'Write the auth section', parent_id: 'w1' });

const BOARD: PlanBoard = {
  anchor: TODAY,
  keys: { month: '2026-09', week: '2026-W36', day: TODAY },
  items: { month: [GOAL], week: [FOCUS], day: [DONE_TASK, OPEN_TASK] },
  carried: [item({ id: 'c1', horizon: 'day', period_key: '2026-09-02', title: 'Chase the Vercel invoice' })],
  weekLinkTargets: [],
};

const render = (board: PlanBoard = BOARD) =>
  renderToStaticMarkup(<PlanAdmin initial={board} serverToday={TODAY} />);

describe('the board', () => {
  it('shows all three horizons at once, not one behind a switcher', () => {
    const html = render();
    expect(html).toContain('September 2026');
    expect(html).toContain('Week 36');
    expect(html).toContain('Friday, Sep 4');
    // The whole point of the layout: the goal is visible while the day is planned.
    expect(html).toContain('Ship the MCP docs');
    expect(html).toContain('Draft the integration guide');
    expect(html).toContain('Write the auth section');
  });

  it('rolls a finished day task up through the week into the month goal', () => {
    // One of the two day tasks is done. The week focus that owns them reads
    // 1/2, and the month goal reads 1/3 — the focus row itself counts too.
    const html = render();
    expect(html).toContain('>1/2<');
    expect(html).toContain('>1/3<');
  });

  it('offers each row the parents it can actually be linked to', () => {
    const html = render();
    // A day task links to a week focus; a week focus links to a month goal.
    expect(html).toContain('↳ Draft the integration guide');
    expect(html).toContain('↳ Ship the MCP docs');
    expect(html).toContain('↳ not linked');
  });

  it('surfaces unfinished work from earlier days instead of losing it', () => {
    const html = render();
    expect(html).toContain('Carried over');
    expect(html).toContain('Chase the Vercel invoice');
    // Dated relative to the day on screen, so its age is readable at a glance.
    expect(html).toContain('2 days ago');
  });

  it('hides the carry-over list when reading a day that has already passed', () => {
    // Looking back at last Tuesday should show last Tuesday, not today's
    // backlog pushed onto a day that is finished with.
    const past: PlanBoard = { ...BOARD, anchor: '2026-08-25', keys: { ...BOARD.keys, day: '2026-08-25' } };
    expect(render(past)).not.toContain('Carried over');
  });

  it('strikes through what is done and nothing else', () => {
    const html = render();
    // Exactly one of the five rows on the board is done, so exactly one strike
    // is correct — a count, not a substring search, because "contains
    // line-through" passes just as happily when every row is struck.
    expect(html.match(/line-through/g)).toHaveLength(1);
    expect(html.indexOf('line-through')).toBeLessThan(html.indexOf('Outline the guide'));
  });

  it('renders an empty board without three copies of the same error', () => {
    const empty: PlanBoard = { ...BOARD, items: { month: [], week: [], day: [] }, carried: [] };
    const html = render(empty);
    expect(html.match(/Nothing here yet/g)).toHaveLength(3);
    expect(html).toContain('September 2026');
  });
});
