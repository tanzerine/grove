import { describe, it, expect } from 'vitest';
import { findUnsupportedClaims } from '../lib/pipeline/claims';

const RESEARCH = 'Industry report: adoption grew 42% in 2025. Pricing starts at $99. Over 3 million teams use it.';

describe('findUnsupportedClaims', () => {
  it('flags an uncited percentage that is not in the research corpus', () => {
    const md = 'Most teams see results fast.\n\nStudies show 85% of marketers quit blogging within a year.';
    const claims = findUnsupportedClaims(md, RESEARCH);
    expect(claims).toHaveLength(1);
    expect(claims[0].token).toContain('85%');
  });

  it('accepts a number that appears in the research corpus', () => {
    const md = 'Adoption grew 42% last year, which changes the math.';
    expect(findUnsupportedClaims(md, RESEARCH)).toEqual([]);
  });

  it('normalizes separators when matching the corpus ("3 million", "$99")', () => {
    const md = 'It costs $99 per month.\n\nMore than 3 million teams already use it.';
    expect(findUnsupportedClaims(md, RESEARCH)).toEqual([]);
  });

  it('accepts a claim cited inline in the same sentence', () => {
    const md = 'Churn hit 27% last quarter, per [the SaaS report](https://example.com/report).';
    expect(findUnsupportedClaims(md, '')).toEqual([]);
  });

  it('accepts a claim when the surrounding paragraph carries a citation', () => {
    const md = 'Churn hit 27% last quarter. The trend is documented in [the SaaS report](https://example.com/report).';
    expect(findUnsupportedClaims(md, '')).toEqual([]);
  });

  it('flags currency and multiplier claims with no support', () => {
    const md = 'Teams save $4,000 a month.\n\nOutput grows 2.5x after the first quarter.';
    const tokens = findUnsupportedClaims(md, RESEARCH).map((c) => c.token);
    expect(tokens.some((t) => t.includes('4,000'))).toBe(true);
    expect(tokens.some((t) => t.toLowerCase().includes('2.5x'))).toBe(true);
  });

  it('ignores non-claim numbers: small counts, years, headings, code', () => {
    const md = [
      '# 7 Ways to Improve in 2026',
      '',
      'There are 3 steps to follow.',
      'The project started in 2024 and took 2 people.',
      '```',
      'retries = 10000',
      '```',
    ].join('\n');
    expect(findUnsupportedClaims(md, '')).toEqual([]);
  });

  // Both shapes below were flagged on live oveners.com drafts scoring 84 and
  // 78, which held them for review indefinitely.
  it('ignores numbers inside a markdown table', () => {
    const md = [
      'Here is how the tools compare.',
      '',
      '| Tool | Starting price | Best for |',
      '|:--- |:--- |:--- |',
      '| Oven AI | $16.50 | Product teams |',
      '| Other | $49 | Agencies |',
    ].join('\n');
    expect(findUnsupportedClaims(md, '')).toEqual([]);
  });

  it('ignores price notation ("$20/month") but still flags money as a magnitude', () => {
    const priced = 'Instead of another $20/month subscription, you pay per icon.';
    expect(findUnsupportedClaims(priced, '')).toEqual([]);

    const magnitude = 'Teams save $4,000 a month by switching.';
    const tokens = findUnsupportedClaims(magnitude, '').map((c) => c.token);
    expect(tokens.some((t) => t.includes('4,000'))).toBe(true);
  });

  it('dedupes the same token across sentences', () => {
    const md = 'Growth was 61% overall.\n\nYes, 61% — a number worth repeating.';
    expect(findUnsupportedClaims(md, '')).toHaveLength(1);
  });
});
