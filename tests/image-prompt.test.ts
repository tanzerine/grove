import { describe, it, expect } from 'vitest';
import {
  ILLUSTRATION_STYLE,
  buildIllustrationPrompt,
  fallbackSubject,
  illustrationBrief,
  imageMarkdown,
  sanitizeAlt,
} from '../lib/images/prompt';

describe('buildIllustrationPrompt', () => {
  it('appends the house style to the subject', () => {
    const p = buildIllustrationPrompt('two stacked panels being lifted apart');
    expect(p.startsWith('two stacked panels being lifted apart,')).toBe(true);
    expect(p).toContain('no text, no people');
  });

  it('returns empty for an empty subject rather than a style-only prompt', () => {
    expect(buildIllustrationPrompt('')).toBe('');
    expect(buildIllustrationPrompt('   \n ')).toBe('');
  });

  it('does not repeat the style when the subject already carries it', () => {
    const once = `a lone brass funnel, ${ILLUSTRATION_STYLE}`;
    expect(buildIllustrationPrompt(once)).toBe(once.replace(/\s+/g, ' '));
  });

  it('normalizes whitespace, strips wrapping quotes and trailing punctuation', () => {
    const p = buildIllustrationPrompt('"a  split\nframe."');
    expect(p).toBe(`a split frame, ${ILLUSTRATION_STYLE}`);
  });

  it('clamps a runaway subject', () => {
    const p = buildIllustrationPrompt('x'.repeat(2000));
    expect(p.length).toBeLessThan(700 + ILLUSTRATION_STYLE.length);
  });
});

describe('sanitizeAlt', () => {
  it('removes characters that would break ![alt](url)', () => {
    expect(sanitizeAlt('How [we] (finally) ship')).toBe('How we finally ship');
  });

  it('collapses newlines and markdown emphasis', () => {
    expect(sanitizeAlt('Cold brew\n**basics**')).toBe('Cold brew basics');
  });

  it('falls back to a generic alt when nothing is left', () => {
    expect(sanitizeAlt('')).toBe('Illustration');
    expect(sanitizeAlt('  ')).toBe('Illustration');
    expect(sanitizeAlt(null)).toBe('Illustration');
  });

  it('clamps on a word boundary', () => {
    const alt = sanitizeAlt('the quick brown fox jumps over the lazy dog again and again', 20);
    expect(alt.length).toBeLessThanOrEqual(20);
    expect(alt.endsWith(' ')).toBe(false);
    expect(alt).toBe('the quick brown fox');
  });
});

describe('imageMarkdown', () => {
  it('emits a markdown image with sanitized alt', () => {
    expect(imageMarkdown('A [nice] shot', 'https://x.co/a.webp')).toBe('![A nice shot](https://x.co/a.webp)');
  });

  it('returns empty without a url', () => {
    expect(imageMarkdown('alt', '')).toBe('');
  });

  it('encodes a url containing spaces', () => {
    expect(imageMarkdown('a', 'https://x.co/my file.webp')).toBe('![a](https://x.co/my%20file.webp)');
  });
});

describe('illustrationBrief', () => {
  const ctx = { title: 'Cold brew at home', heading: 'Grind size', selection: 'A coarse grind keeps it sweet.' };

  it('prefers what the author typed', () => {
    expect(illustrationBrief({ ...ctx, hint: 'a burr grinder' })).toEqual({ focus: 'a burr grinder', source: 'hint' });
  });

  it('falls back to the selection, then the heading, then the title', () => {
    expect(illustrationBrief(ctx).source).toBe('selection');
    expect(illustrationBrief({ ...ctx, selection: '' }).source).toBe('heading');
    expect(illustrationBrief({ title: ctx.title }).source).toBe('title');
  });

  it('ignores a selection too short to describe anything', () => {
    expect(illustrationBrief({ ...ctx, selection: 'sweet' }).source).toBe('heading');
  });

  it('reports none when there is nothing to go on', () => {
    expect(illustrationBrief({})).toEqual({ focus: '', source: 'none' });
    expect(fallbackSubject(illustrationBrief({}))).toBe('');
  });

  it('clamps long input and collapses whitespace', () => {
    const brief = illustrationBrief({ hint: `  a   ${'long '.repeat(200)}  ` });
    expect(brief.focus.length).toBeLessThanOrEqual(400);
    expect(brief.focus).not.toContain('  ');
  });
});
