import { describe, it, expect } from 'vitest';
import { extractTakeaways } from '../lib/takeaways';

describe('extractTakeaways', () => {
  it('pulls bullets under a bold "Key takeaways" label', () => {
    const md = [
      '# Title', 'Hook line.', '',
      '**Key takeaways**', '',
      '- Paper filters trap oils, so the cup tastes cleaner.',
      '- Grind size matters more than bean origin.',
      '- A scale beats eyeballing every time.', '',
      '## First section', 'Body.',
    ].join('\n');
    expect(extractTakeaways(md)).toEqual([
      'Paper filters trap oils, so the cup tastes cleaner.',
      'Grind size matters more than bean origin.',
      'A scale beats eyeballing every time.',
    ]);
  });

  it('recognizes heading + TL;DR variants', () => {
    for (const label of ['## Key Takeaways', '### Takeaways', 'TL;DR', '## TLDR', '**The short version**']) {
      const md = `# T\n\n${label}\n- one\n- two`;
      expect(extractTakeaways(md)).toEqual(['one', 'two']);
    }
  });

  it('accepts numbered bullets and stops at the first non-bullet', () => {
    const md = '# T\n\n**Key takeaways**\n1. first\n2. second\n\nA paragraph, not a bullet.\n- ignored';
    expect(extractTakeaways(md)).toEqual(['first', 'second']);
  });

  it('strips inline markdown from bullets', () => {
    const md = '# T\n\n**Key takeaways**\n- Use **GLB** — see [docs](https://x.com).';
    expect(extractTakeaways(md)).toEqual(['Use GLB — see docs.']);
  });

  it('ignores a label inside a code fence', () => {
    const md = '# T\n\n```\n**Key takeaways**\n- fake\n```\nReal prose.';
    expect(extractTakeaways(md)).toEqual([]);
  });

  it('returns [] when there is no takeaways block or no bullets follow it', () => {
    expect(extractTakeaways('# T\n\nJust prose, no summary.')).toEqual([]);
    expect(extractTakeaways('# T\n\n**Key takeaways**\n\nThen a paragraph, no bullets.')).toEqual([]);
  });
});
