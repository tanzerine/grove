import { describe, it, expect } from 'vitest';
import { parseRepoRef, pickDocPaths, repoKbPrompt, type RepoKnowledge } from '../lib/pipeline/repo-knowledge';

describe('parseRepoRef', () => {
  it('accepts bare owner/repo', () => {
    expect(parseRepoRef('tanzerine/grove')).toBe('tanzerine/grove');
    expect(parseRepoRef('  vercel/next.js  ')).toBe('vercel/next.js');
  });

  it('accepts github.com URLs in every common shape', () => {
    expect(parseRepoRef('https://github.com/tanzerine/grove')).toBe('tanzerine/grove');
    expect(parseRepoRef('http://www.github.com/tanzerine/grove/')).toBe('tanzerine/grove');
    expect(parseRepoRef('github.com/tanzerine/grove.git')).toBe('tanzerine/grove');
    expect(parseRepoRef('https://github.com/tanzerine/grove/tree/main/lib')).toBe('tanzerine/grove');
    expect(parseRepoRef('https://github.com/tanzerine/grove?tab=readme')).toBe('tanzerine/grove');
  });

  it('rejects everything that is not a repo reference', () => {
    expect(parseRepoRef('')).toBeNull();
    expect(parseRepoRef('not a repo')).toBeNull();
    expect(parseRepoRef('justowner')).toBeNull();
    expect(parseRepoRef('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseRepoRef('owner/repo/extra')).toBeNull();
    expect(parseRepoRef('owner/re po')).toBeNull();
    expect(parseRepoRef('../etc/passwd')).toBeNull();
  });
});

describe('pickDocPaths', () => {
  it('puts the root README first, then named root docs, then docs/', () => {
    const picked = pickDocPaths([
      'docs/usage.md',
      'src/index.ts',
      'ARCHITECTURE.md',
      'README.md',
      'CHANGELOG.md',
    ]);
    expect(picked[0]).toBe('README.md');
    expect(picked.slice(1, 3)).toEqual(expect.arrayContaining(['ARCHITECTURE.md', 'CHANGELOG.md']));
    expect(picked).toContain('docs/usage.md');
    expect(picked).not.toContain('src/index.ts');
  });

  it('skips meta docs, tests, and vendored trees', () => {
    const picked = pickDocPaths([
      'README.md',
      'CODE_OF_CONDUCT.md',
      'CONTRIBUTING.md',
      'LICENSE.md',
      'node_modules/left-pad/README.md',
      'tests/fixtures/sample.md',
      '.github/ISSUE_TEMPLATE/bug.md',
    ]);
    expect(picked).toEqual(['README.md']);
  });

  it('prefers shallower docs pages and caps the list at 12', () => {
    const many = Array.from({ length: 30 }, (_, i) => `docs/deep/nested/page-${i}.md`);
    const picked = pickDocPaths(['docs/intro.md', ...many]);
    expect(picked[0]).toBe('docs/intro.md');
    expect(picked.length).toBe(12);
  });

  it('returns an empty list when the repo has no docs at all', () => {
    expect(pickDocPaths(['src/a.ts', 'package.json'])).toEqual([]);
  });
});

describe('repoKbPrompt', () => {
  const kb: RepoKnowledge = {
    repo: 'acme/oven',
    synced_at: '2026-07-10T00:00:00Z',
    product_summary: 'Oven bakes 3D icons from prompts.',
    features: [
      {
        name: 'Style memory',
        what_it_does: 'Locks a brand style once and reuses it on every render.',
        how_to_use: ['Open styles panel', 'Click "Save as style"', 'Pick it on your next bake'],
        details: 'One style per workspace on the free plan.',
      },
    ],
    concepts: ['bake', 'style memory'],
    setup: ['Sign up', 'Create a workspace'],
    files_read: ['README.md'],
  };

  it('serializes summary, features, steps, and terminology', () => {
    const out = repoKbPrompt(kb);
    expect(out).toContain('acme/oven');
    expect(out).toContain('Oven bakes 3D icons');
    expect(out).toContain('FEATURE: Style memory');
    expect(out).toContain('2. Click "Save as style"');
    expect(out).toContain('One style per workspace');
    expect(out).toContain('bake, style memory');
  });

  it('returns an empty string when there is nothing to say', () => {
    expect(repoKbPrompt(null)).toBe('');
    expect(repoKbPrompt(undefined)).toBe('');
    expect(repoKbPrompt({ ...kb, product_summary: '', features: [] })).toBe('');
  });
});
