import { describe, it, expect } from 'vitest';
import {
  isComparisonKeyword, hasDisclosure, hasComparisonTable, comparisonWriterRules,
} from '../lib/pipeline/comparison';
import { validatePost, blockingIssues } from '../lib/pipeline/validator';
import { rubricPromptBlock } from '../lib/pipeline/manager-rubric';
import { composeRepairInstructions } from '../lib/pipeline/manager';
import { genreFor } from '../lib/blog-genre';

describe('isComparisonKeyword', () => {
  it.each([
    'buffer alternatives', 'hootsuite alternative', 'free hootsuite alternative',
    'buffer vs hootsuite', 'later versus planoly', 'sprout social competitors',
    'best tools to schedule social media posts', 'best social media scheduling software',
  ])('treats %s as a comparison', (k) => expect(isComparisonKeyword(k)).toBe(true));

  it.each([
    'schedule linkedin posts', 'linkedin mcp server', 'instagram line break',
    'best time to post on instagram', 'what is an mcp server', '', undefined,
  ])('leaves %s alone', (k) => expect(isComparisonKeyword(k as string)).toBe(false));
});

describe('disclosure and table detection', () => {
  it('finds the disclosure in the forms writers use', () => {
    expect(hasDisclosure('We make Krevaya, so weigh our spot.', 'Krevaya')).toBe(true);
    expect(hasDisclosure('Krevaya is our product.', 'Krevaya')).toBe(true);
    expect(hasDisclosure('Krevaya is a scheduler.', 'Krevaya')).toBe(false);
  });

  it('needs a real header + separator row, not a stray pipe', () => {
    expect(hasComparisonTable('| Tool | Price |\n| --- | --- |\n| A | $1 |')).toBe(true);
    expect(hasComparisonTable('a | b')).toBe(false);
  });

  it('writer rules carry the brand name into the disclosure line', () => {
    expect(comparisonWriterRules('Krevaya')).toContain('We make Krevaya');
  });
});

// A short draft is fine: these tests look only at the flags comparison mode
// adds or lifts, not at length or rhythm.
const DRAFT = `# The best Buffer alternatives in 2026

We make Krevaya, so weigh our place on this list accordingly.

| Tool | For | From |
| --- | --- | --- |
| Krevaya | small teams | $29 |

Tools like Buffer charge per channel. You could also use Publer.
`;

describe('validator in comparison mode', () => {
  it('blocks naming rivals in a normal article', () => {
    const v = validatePost(DRAFT, { businessName: 'Krevaya' });
    expect(blockingIssues(v).some((i) => i.startsWith('REFERRAL_AWAY'))).toBe(true);
  });

  it('allows naming rivals when the brief is a comparison', () => {
    const v = validatePost(DRAFT, { format: 'comparison', businessName: 'Krevaya' });
    expect(v.issues.some((i) => i.startsWith('REFERRAL_AWAY'))).toBe(false);
    expect(v.issues.some((i) => i.startsWith('COMPARISON_'))).toBe(false);
  });

  it('still blocks sending the reader to an agency', () => {
    const v = validatePost(`${DRAFT}\nOr hire a freelancer.`, { format: 'comparison', businessName: 'Krevaya' });
    expect(blockingIssues(v).some((i) => i.startsWith('REFERRAL_AWAY'))).toBe(true);
  });

  it('blocks a comparison that never discloses, and notes a missing table', () => {
    const bare = '# Best Buffer alternatives\n\nTools like Buffer are fine.\n';
    const v = validatePost(bare, { format: 'comparison', businessName: 'Krevaya' });
    expect(blockingIssues(v).some((i) => i.startsWith('COMPARISON_NO_DISCLOSURE'))).toBe(true);
    expect(v.issues.some((i) => i.startsWith('COMPARISON_NO_TABLE'))).toBe(true);
  });

  it('lets a comparison cite each rival without tripping OVER_CITED', () => {
    const links = Array.from({ length: 10 }, (_, i) => `[p${i}](https://x${i}.com/pricing)`).join(' ');
    const normal = validatePost(`${DRAFT}\n${links}`, {});
    const cmp = validatePost(`${DRAFT}\n${links}`, { format: 'comparison', businessName: 'Krevaya' });
    expect(normal.issues.some((i) => i.startsWith('OVER_CITED'))).toBe(true);
    expect(cmp.issues.some((i) => i.startsWith('OVER_CITED'))).toBe(false);
  });
});

describe('manager and repair in comparison mode', () => {
  it('swaps the no_referral_away rule text only for comparisons', () => {
    expect(rubricPromptBlock()).toMatch(/never name, link, recommend/);
    const cmp = rubricPromptBlock('comparison');
    expect(cmp).toMatch(/naming competing products is required/);
    expect(cmp).not.toMatch(/never name, link, recommend/);
  });

  it('only tells the rewrite to drop competitor links when that was flagged', () => {
    expect(composeRepairInstructions(null, ['COMPARISON_NO_DISCLOSURE: say it'])).not.toMatch(/link to a competitor/);
    expect(composeRepairInstructions(null, ["REFERRAL_AWAY: 'tools like X'"])).toMatch(/link to a competitor/);
  });

  it('shows a comparison to readers as a roundup', () => {
    expect(genreFor('comparison', 'x').id).toBe(genreFor('curation', 'x').id);
  });
});
