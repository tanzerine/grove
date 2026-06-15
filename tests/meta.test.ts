import { describe, it, expect } from 'vitest';
import { deriveMetaDescription } from '../lib/meta';

describe('deriveMetaDescription', () => {
  it('keeps a usable model description, stripping markdown', () => {
    const m = 'A clear, specific summary of the article that is comfortably over fifty characters long.';
    expect(deriveMetaDescription({ modelMeta: `**${m}**` })).toBe(m);
  });

  it('caps an over-long description at 160 chars without cutting mid-word', () => {
    const long = 'word '.repeat(60).trim(); // ~300 chars
    const out = deriveMetaDescription({ modelMeta: long });
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\bwor…$/); // didn't slice through a word
  });

  it('falls back to the first Key Takeaway when the model meta is missing', () => {
    const body = [
      '# Title', 'Hook.', '',
      '**Key takeaways**',
      '- Paper filters trap oils, so the cup tastes noticeably cleaner than metal.',
      '- Grind size matters more than bean origin for most home setups.',
      '', '## Section', 'Body.',
    ].join('\n');
    expect(deriveMetaDescription({ modelMeta: '', body }))
      .toBe('Paper filters trap oils, so the cup tastes noticeably cleaner than metal.');
  });

  it('falls back to the promise when there is no takeaway', () => {
    expect(deriveMetaDescription({ modelMeta: 'too short', body: '# T\n\nProse.', promise: 'Learn exactly how to dial in espresso at home in one afternoon.' }))
      .toBe('Learn exactly how to dial in espresso at home in one afternoon.');
  });
});
