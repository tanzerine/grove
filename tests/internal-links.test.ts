import { describe, it, expect } from 'vitest';
import { keyphrases, injectInternalLinks, type LinkTarget } from '../lib/internal-links';

const BASE = '/b/demo';
const t = (slug: string, title: string): LinkTarget => ({ slug, title });

describe('keyphrases', () => {
  it('builds multi-word phrases from non-stopword runs, longest first', () => {
    const p = keyphrases('How to Brew Filter Coffee');
    expect(p[0]).toBe('brew filter coffee');
    expect(p).toContain('filter coffee');
    expect(p).toContain('brew filter');
    expect(p).not.toContain('how to');
  });
  it('keeps long single CJK tokens', () => {
    expect(keyphrases('신선한 원두 보관법')).toContain('신선한 원두 보관법');
  });
  it('handles empty/stopword-only titles', () => {
    expect(keyphrases(null)).toEqual([]);
    expect(keyphrases('How to do it')).toEqual([]);
  });
});

describe('injectInternalLinks', () => {
  it('links the first clean occurrence and reports it', () => {
    const body = 'Morning routines matter.\n\nGood filter coffee starts with fresh water.';
    const { body: out, added } = injectInternalLinks(body, [t('brew', 'How to Brew Filter Coffee')], BASE);
    expect(out).toContain('[filter coffee](/b/demo/brew)');
    expect(added).toEqual([{ slug: 'brew', phrase: 'filter coffee' }]);
  });

  it('preserves original casing of the matched text', () => {
    const body = 'Filter Coffee is forgiving.';
    const { body: out } = injectInternalLinks(body, [t('brew', 'filter coffee guide')], BASE);
    expect(out).toContain('[Filter Coffee](/b/demo/brew)');
  });

  it('never links inside headings, code fences, quotes, or tables', () => {
    const body = [
      '## All about filter coffee',
      '> filter coffee quote',
      '| filter coffee | row |',
      '```',
      'filter coffee in code',
      '```',
    ].join('\n');
    const { body: out, added } = injectInternalLinks(body, [t('brew', 'filter coffee')], BASE);
    expect(out).toBe(body);
    expect(added).toHaveLength(0);
  });

  it('never nests inside an existing link', () => {
    const body = 'Read [our filter coffee guide](https://x.test) today.';
    const { added } = injectInternalLinks(body, [t('brew', 'filter coffee')], BASE);
    expect(added).toHaveLength(0);
  });

  it('skips targets the body already links to', () => {
    const body = 'See [this](/b/demo/brew). More filter coffee talk here.';
    const { added } = injectInternalLinks(body, [t('brew', 'filter coffee')], BASE);
    expect(added).toHaveLength(0);
  });

  it('respects word boundaries (no mid-word matches)', () => {
    const body = 'The unfilter coffeepot is a myth.';
    const { added } = injectInternalLinks(body, [t('brew', 'filter coffee')], BASE);
    expect(added).toHaveLength(0);
  });

  it('caps at maxLinks across targets, one per target', () => {
    const body = [
      'We love filter coffee here.',
      'A good coffee grinder helps.',
      'Cold brew is different.',
      'And filter coffee again — twice.',
    ].join('\n\n');
    const { body: out, added } = injectInternalLinks(body, [
      t('a', 'Filter Coffee'),
      t('b', 'Choosing a Coffee Grinder'),
      t('c', 'Cold Brew Basics'),
    ], BASE, 2);
    expect(added).toHaveLength(2);
    expect((out.match(/\/b\/demo\/a\)/g) ?? []).length).toBe(1); // only first occurrence
  });

  it('links CJK phrases at CJK boundaries', () => {
    const body = '집에서 신선한 원두 보관법 을 알아봅시다.';
    const { body: out, added } = injectInternalLinks(body, [t('beans', '신선한 원두 보관법')], BASE);
    expect(added).toHaveLength(1);
    expect(out).toContain('[신선한 원두 보관법](/b/demo/beans)');
  });

  it('returns body unchanged with no targets', () => {
    const { body: out } = injectInternalLinks('hello world', [], BASE);
    expect(out).toBe('hello world');
  });

  // Stress run: a phrase inside `inline code` was being wrapped in a link,
  // which renders as literal [brackets](…) inside the code span.
  it('never links a phrase inside an inline code span', () => {
    const { body: out, added } = injectInternalLinks(
      'Run `brew filter coffee` to start.',
      [t('brew', 'How to Brew Filter Coffee')],
      BASE,
    );
    expect(added).toHaveLength(0);
    expect(out).toBe('Run `brew filter coffee` to start.');
  });

  it('still links the same phrase when it also appears in prose', () => {
    const { body: out, added } = injectInternalLinks(
      'Run `brew filter coffee` first. Then brew filter coffee slowly.',
      [t('brew', 'How to Brew Filter Coffee')],
      BASE,
    );
    expect(added).toHaveLength(1);
    expect(out).toContain('`brew filter coffee`');
    expect(out).toContain('[brew filter coffee](/b/demo/brew)');
  });
});
