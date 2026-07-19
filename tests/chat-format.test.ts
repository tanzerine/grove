import { describe, it, expect } from 'vitest';
import { parseInline, parseChatText } from '../lib/assistant/chat-format';

describe('parseInline', () => {
  it('splits bold and code out of plain text', () => {
    expect(parseInline('hit **6.8 on Google** via `gsc` sync')).toEqual([
      { text: 'hit ' },
      { text: '6.8 on Google', bold: true },
      { text: ' via ' },
      { text: 'gsc', code: true },
      { text: ' sync' },
    ]);
  });

  it('passes plain text through untouched', () => {
    expect(parseInline('no markup here')).toEqual([{ text: 'no markup here' }]);
  });
});

describe('parseChatText', () => {
  it('parses the production reply shape: bold intro, numbered list, bold lead-ins', () => {
    const blocks = parseChatText(
      'Your top article is **"The 7 Best AI 3D Icon Generators"**.\n\n' +
      '1. **Page 1 Ranking:** position **6.8 on Google**.\n' +
      '2. **Traffic Share:** 41 reads this month.\n\n' +
      '**Next Step:** optimize the CTA.',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'p', 'num', 'num', 'p', 'p']);
    const first = blocks[2];
    expect(first.kind === 'num' && first.num).toBe('1');
    expect(first.spans[0]).toEqual({ text: 'Page 1 Ranking:', bold: true });
    // "**Next Step:**" must render as a bold paragraph, not a bullet
    const last = blocks[5];
    expect(last.kind).toBe('p');
    expect(last.spans[0]).toEqual({ text: 'Next Step:', bold: true });
  });

  it('parses "-" and "•" bullets, renders headings as bold lines', () => {
    const blocks = parseChatText('- first\n• second\n### Why it works');
    expect(blocks.map((b) => b.kind)).toEqual(['bullet', 'bullet', 'p']);
    expect(blocks[2].spans).toEqual([{ text: 'Why it works', bold: true }]);
  });

  it('collapses blank runs and trims edge breaks', () => {
    const blocks = parseChatText('\n\na\n\n\n\nb\n\n');
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'p', 'p']);
    expect(blocks[1].spans).toEqual([]);   // single break between a and b
  });
});
