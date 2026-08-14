/**
 * What a re-sync decides to do.
 *
 * This is the tool that runs unattended, in someone else's repository, with
 * write access to their content directory. The two mistakes that matter are
 * both silent: calling a stale file current (their site serves the old article
 * forever) and calling a live file orphaned off a partial list (an agent
 * deletes articles that were simply on the next page).
 */
import { describe, it, expect } from 'vitest';
import { planSync } from '@/lib/mcp/sync';

const remote = [
  { slug: 'a', checksum: 'aaa', title: 'A' },
  { slug: 'b', checksum: 'bbb', title: 'B' },
  { slug: 'c', checksum: 'ccc', title: 'C' },
];

describe('planSync', () => {
  it('adds what is published and missing locally', () => {
    const plan = planSync(remote, [{ slug: 'a', checksum: 'aaa' }]);
    expect(plan.create.map((i) => i.slug)).toEqual(['b', 'c']);
    expect(plan.unchanged).toEqual(['a']);
  });

  it('rewrites what changed upstream, and says which file', () => {
    const plan = planSync(remote, [
      { slug: 'a', checksum: 'OLD', path: 'content/blog/a.mdx' },
      { slug: 'b', checksum: 'bbb' },
      { slug: 'c', checksum: 'ccc' },
    ]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0].slug).toBe('a');
    expect(plan.update[0].path).toBe('content/blog/a.mdx');
    // The plan carries the NEW checksum so the agent can write it back without
    // a second call.
    expect(plan.update[0].checksum).toBe('aaa');
  });

  it('rewrites a file with no checksum rather than assuming it is current', () => {
    // A file written before this feature existed, or one whose frontmatter was
    // remapped without keeping groveChecksum. It may well be identical —
    // nothing here can prove it, and a stale article is the failure this whole
    // feature exists to prevent. One rewrite and it goes quiet forever.
    const plan = planSync(remote, [{ slug: 'a' }, { slug: 'b', checksum: 'bbb' }, { slug: 'c', checksum: 'ccc' }]);
    expect(plan.update.map((i) => i.slug)).toEqual(['a']);
    expect(plan.update[0].reason).toContain('groveChecksum');
  });

  it('reports local files with no published article', () => {
    const plan = planSync(remote, [
      { slug: 'a', checksum: 'aaa' },
      { slug: 'b', checksum: 'bbb' },
      { slug: 'c', checksum: 'ccc' },
      { slug: 'gone', checksum: 'zzz', path: 'content/blog/gone.mdx' },
    ]);
    expect(plan.orphaned.map((i) => i.path)).toEqual(['content/blog/gone.mdx']);
  });

  it('suppresses orphan detection when the remote list was truncated', () => {
    // The dangerous case: an agent that deletes everything the first page
    // didn't mention. The plan must both return no orphans AND say why, since
    // an empty list on its own reads as "nothing to clean up".
    const plan = planSync(remote, [{ slug: 'x', path: 'content/blog/x.mdx' }], { remoteComplete: false });
    expect(plan.orphaned).toEqual([]);
    expect(plan.remote_complete).toBe(false);
    expect(plan.summary).toMatch(/do not delete/i);
  });

  it('matches slugs case- and whitespace-insensitively', () => {
    const plan = planSync(remote, [{ slug: ' A ', checksum: 'aaa' }]);
    expect(plan.unchanged).toEqual(['a']);
    expect(plan.create.map((i) => i.slug)).toEqual(['b', 'c']);
  });

  it('collapses a slug listed twice locally instead of contradicting itself', () => {
    const plan = planSync(remote, [
      { slug: 'a', checksum: 'OLD' },
      { slug: 'a', checksum: 'aaa' },
    ]);
    expect(plan.unchanged).toEqual(['a']);
    expect(plan.update).toHaveLength(0);
  });

  it('says plainly when there is nothing to do', () => {
    const plan = planSync(remote, remote.map((r) => ({ slug: r.slug, checksum: r.checksum })));
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
    expect(plan.summary).toContain('Nothing to write');
  });

  it('survives empty inputs on either side', () => {
    expect(planSync([], []).summary).toContain('Nothing to write');
    expect(planSync(remote, []).create).toHaveLength(3);
    expect(planSync([], [{ slug: 'a' }]).orphaned).toHaveLength(1);
  });
});
