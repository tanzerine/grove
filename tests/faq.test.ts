import { describe, it, expect } from 'vitest';
import { extractFaq } from '../lib/faq';

describe('extractFaq', () => {
  it('pulls Q&A pairs from a ## FAQ section', () => {
    const md = [
      '# Title',
      'Intro paragraph.',
      '## Body',
      '### A subsection that is not a question',
      'Some prose.',
      '## FAQ',
      '### How long does it take?',
      'About ten minutes for a first pass.',
      '### Can I undo it?',
      'Yes, every step is reversible.',
    ].join('\n');
    expect(extractFaq(md)).toEqual([
      { question: 'How long does it take?', answer: 'About ten minutes for a first pass.' },
      { question: 'Can I undo it?', answer: 'Yes, every step is reversible.' },
    ]);
  });

  it('recognizes heading variants (Frequently Asked Questions, FAQs, Q&A)', () => {
    for (const h of ['## Frequently Asked Questions', '## FAQs', '## Q & A']) {
      const md = `# T\n\n${h}\n\n### Q one?\nAnswer one.\n\n### Q two?\nAnswer two.`;
      expect(extractFaq(md)).toHaveLength(2);
    }
  });

  it('ignores question-shaped H3s outside the FAQ section', () => {
    const md = '# T\n\n## Guide\n### Why does this matter?\nBecause it does.\n\n## Next\nMore prose.';
    expect(extractFaq(md)).toEqual([]);
  });

  it('stops collecting at the next H2 after the FAQ', () => {
    const md = '# T\n\n## FAQ\n### Only one?\nYes.\n\n## Conclusion\n### Not a faq\nIgnore me.';
    expect(extractFaq(md)).toEqual([{ question: 'Only one?', answer: 'Yes.' }]);
  });

  it('strips inline markdown from questions and answers', () => {
    const md = '# T\n\n## FAQ\n### Is **GLB** supported?\nYes — see [the docs](https://x.com/docs) for details.';
    expect(extractFaq(md)).toEqual([
      { question: 'Is GLB supported?', answer: 'Yes — see the docs for details.' },
    ]);
  });

  it('does not treat a ## inside a code fence as the FAQ heading', () => {
    const md = '# T\n\n## Setup\n```\n## FAQ\n### fake?\nnope\n```\nDone.';
    expect(extractFaq(md)).toEqual([]);
  });

  it('drops a question that has no answer body', () => {
    const md = '# T\n\n## FAQ\n### Dangling question?\n### Has an answer?\nYes it does.';
    expect(extractFaq(md)).toEqual([{ question: 'Has an answer?', answer: 'Yes it does.' }]);
  });

  it('returns [] for empty or FAQ-less input', () => {
    expect(extractFaq('')).toEqual([]);
    expect(extractFaq('# Just a title\n\nNo questions here.')).toEqual([]);
  });
});
