import { describe, it, expect } from 'vitest';
import { stripLeadingH1, withTitleH1 } from '../lib/article-body';

describe('stripLeadingH1', () => {
  it('drops a leading # heading', () => {
    expect(stripLeadingH1('# My Title\n\nBody text.')).toBe('\nBody text.');
  });

  it('drops the H1 even after leading blank lines', () => {
    expect(stripLeadingH1('\n\n# My Title\nBody.')).toBe('\n\nBody.');
  });

  it('keeps the cover image injected right after the H1', () => {
    const md = '# Title\n\n![cover](https://x.com/c.png)\n\nIntro.';
    expect(stripLeadingH1(md)).toBe('\n![cover](https://x.com/c.png)\n\nIntro.');
  });

  it('leaves a body that starts with a paragraph untouched', () => {
    const md = 'Intro paragraph.\n\n# Later heading\nMore.';
    expect(stripLeadingH1(md)).toBe(md);
  });

  it('leaves an H2-first body untouched (## is not the title)', () => {
    const md = '## Section\nBody.';
    expect(stripLeadingH1(md)).toBe(md);
  });

  it('only removes the first H1 — a later H1 is the author\'s own', () => {
    const md = '# Title\n\nIntro.\n\n# Another H1\nBody.';
    expect(stripLeadingH1(md)).toBe('\nIntro.\n\n# Another H1\nBody.');
  });

  it('passes empty input through', () => {
    expect(stripLeadingH1('')).toBe('');
  });
});

describe('withTitleH1', () => {
  it('prepends the title as an H1 with a blank line', () => {
    expect(withTitleH1('My Title', 'Body text.')).toBe('# My Title\n\nBody text.');
  });

  it('collapses leading blank space left by a prior strip', () => {
    expect(withTitleH1('My Title', '\nBody text.')).toBe('# My Title\n\nBody text.');
  });

  it('no-ops on an empty title', () => {
    expect(withTitleH1('  ', 'Body text.')).toBe('Body text.');
  });

  it('round-trips with stripLeadingH1', () => {
    const stored = '# Round Trip\n\n![cover](https://x.com/c.png)\n\nIntro.';
    const stripped = stripLeadingH1(stored);
    expect(withTitleH1('Round Trip', stripped)).toBe(stored);
  });
});
