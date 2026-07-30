/**
 * The blog list layout in public/embed.js — featured card vs. grid, and the
 * empty-state decision.
 *
 * The bug this locks down: the featured post is removed from the grid pool, so
 * a blog with exactly ONE published post left the pool empty and fell into the
 * search-failed branch — rendering "No articles match" directly under a working
 * featured card. That is every blog's first publish, on the shared embed, so
 * every customer hit it at the moment their blog was most likely to be read.
 *
 * Same trick as embed-theme.test.ts: the suite is `environment: 'node'` and
 * embed.js has no DOM harness, so the pure function is pulled out of the IIFE
 * and evaluated directly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = readFileSync(path.join(process.cwd(), 'public/embed.js'), 'utf8');

type Post = { slug: string };
type Plan = {
  feat: Post | null;
  pages: number;
  page: number;
  items: Post[];
  noMatch: boolean;
};
type PlanList = (posts: Post[], isDefault: boolean, page: number, per: number) => Plan;

function extractPlanList(): PlanList {
  const m = SRC.match(/function planList\(posts, isDefault, page, per\) \{[\s\S]*?\n  \}/);
  if (!m) throw new Error('planList() not found in embed.js');
  return new Function(`${m[0]}; return planList;`)() as PlanList;
}

const planList = extractPlanList();
const posts = (n: number): Post[] =>
  Array.from({ length: n }, (_, i) => ({ slug: `post-${i + 1}` }));

describe('planList — featured card vs. grid', () => {
  it('features the newest post and keeps it out of the grid', () => {
    const p = planList(posts(3), true, 1, 9);
    expect(p.feat?.slug).toBe('post-1');
    expect(p.items.map((i) => i.slug)).toEqual(['post-2', 'post-3']);
  });

  it('does not feature anything once a filter or search is active', () => {
    const p = planList(posts(3), false, 1, 9);
    expect(p.feat).toBeNull();
    // nothing is held back, so every match is in the grid
    expect(p.items.map((i) => i.slug)).toEqual(['post-1', 'post-2', 'post-3']);
  });

  it('paginates the pool, not the full list — the featured post never counts', () => {
    // 10 posts: 1 featured + 9 pooled == exactly one page
    expect(planList(posts(10), true, 1, 9).pages).toBe(1);
    // 11 posts: 1 featured + 10 pooled spills to a second page
    const p = planList(posts(11), true, 2, 9);
    expect(p.pages).toBe(2);
    expect(p.items.map((i) => i.slug)).toEqual(['post-11']);
  });

  it('clamps an out-of-range page instead of rendering nothing', () => {
    expect(planList(posts(3), true, 99, 9).page).toBe(1);
    expect(planList(posts(3), true, 0, 9).page).toBe(1);
    expect(planList(posts(3), true, -5, 9).items).toHaveLength(2);
  });
});

describe('planList — the empty grid is only "no match" when something filtered', () => {
  it('REGRESSION: a blog with one published post shows the featured card and no empty state', () => {
    const p = planList(posts(1), true, 1, 9);
    expect(p.feat?.slug).toBe('post-1');
    expect(p.items).toEqual([]);
    // the whole point: an empty grid here means "already featured", not "no match"
    expect(p.noMatch).toBe(false);
  });

  it('still says "no match" when a search or genre filter really matched nothing', () => {
    const p = planList([], false, 1, 9);
    expect(p.feat).toBeNull();
    expect(p.items).toEqual([]);
    expect(p.noMatch).toBe(true);
  });

  it('never claims "no match" on the default view, at any post count', () => {
    for (const n of [0, 1, 2, 9, 10, 25]) {
      expect(planList(posts(n), true, 1, 9).noMatch).toBe(false);
    }
  });
});
