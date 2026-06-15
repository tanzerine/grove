import { describe, it, expect } from 'vitest';
import { validatePost } from '../lib/pipeline/validator';

const TITLE = 'My Real Title';

/** A clean "Key takeaways" TL;DR (3 bullets) so fixtures satisfy that rule. */
const TAKEAWAYS = [
  '',
  '**Key takeaways**',
  '',
  '- First takeaway that is specific and under fifteen words.',
  '- Second takeaway that stands on its own as a claim.',
  '- Third takeaway a reader could quote without any context.',
].join('\n');

/** A clean 2-pair FAQ section so fixtures satisfy the FAQ rule. */
const FAQ = [
  '',
  '## FAQ',
  '',
  '### Is this a real question?',
  'Yes. It is a real question with a tight answer that resolves it directly for the reader.',
  '',
  '### Does it have a second question?',
  'It does. The answer stands on its own so an answer engine could quote it cleanly.',
].join('\n');

/** H1 + prose + two citations — no takeaways, no FAQ. Compose to isolate rules. */
function coreBody(title = TITLE): string {
  const short = 'It works well.';                       // 3 words
  const long =
    'This is a deliberately long sentence that runs well past twenty words so the variety check clearly sees both short and long forms here.'; // ~24 words
  const lines: string[] = [`# ${title}`, '', 'I tested this on a real project last month.'];
  for (let i = 0; i < 30; i++) lines.push(`${short} ${long}`);
  // exactly two citations (sweet spot 2–4)
  lines.push('Here is [a source](https://example.com/a) and [another](https://example.com/b).');
  return lines.join('\n');
}

/** Build an 800+ word post that satisfies every validator rule. */
function goodBody(title = TITLE): string {
  return [coreBody(title), TAKEAWAYS, FAQ].join('\n');
}

describe('validatePost', () => {
  it('passes a well-formed post', () => {
    const v = validatePost(goodBody(), { title: TITLE });
    expect(v.issues).toEqual([]);
    expect(v.passed).toBe(true);
    expect(v.stats.word_count).toBeGreaterThanOrEqual(800);
  });

  it('flags thin content', () => {
    const v = validatePost(`# ${TITLE}\n\nI tested it. Too short.`, { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('THIN_CONTENT'))).toBe(true);
    expect(v.passed).toBe(false);
  });

  it('flags an H1 that does not match the title (the desync bug)', () => {
    const body = goodBody('A Completely Different Headline');
    const v = validatePost(body, { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('TITLE_H1_MISMATCH'))).toBe(true);
  });

  it('flags referring the reader to a competitor / third party', () => {
    const v = validatePost(goodBody() + '\n\nYou can also use Notion for this.', { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('REFERRAL_AWAY'))).toBe(true);
  });

  it('catches "tools like X" referral phrasing', () => {
    const v = validatePost(goodBody() + '\n\nThere are tools like Canva too.', { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('REFERRAL_AWAY'))).toBe(true);
  });

  it('flags banned AI-tell phrases', () => {
    const v = validatePost(goodBody() + '\n\nThis is a real game-changer.', { title: TITLE });
    expect(v.issues.some((i) => i.includes('game-changer'))).toBe(true);
  });

  it('flags too few citations', () => {
    const body = `# ${TITLE}\n\nI tested it. ${'Words here and there in a sentence. '.repeat(200)}`;
    const v = validatePost(body, { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('LOW_CITATIONS'))).toBe(true);
  });

  it('flags a post with no FAQ section', () => {
    const v = validatePost([coreBody(), TAKEAWAYS].join('\n'), { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('MISSING_FAQ'))).toBe(true);
    expect(v.stats.faq_count).toBe(0);
  });

  it('flags a post with no key takeaways', () => {
    const v = validatePost([coreBody(), FAQ].join('\n'), { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('MISSING_KEY_TAKEAWAYS'))).toBe(true);
    expect(v.stats.key_takeaways_count).toBe(0);
  });

  it('counts FAQ + takeaways and stays clean when both are present', () => {
    const v = validatePost(goodBody(), { title: TITLE });
    expect(v.issues).toEqual([]);
    expect(v.stats.faq_count).toBe(2);
    expect(v.stats.key_takeaways_count).toBe(3);
  });

  it('flags consensus SERP subtopics the draft skips', () => {
    const v = validatePost(goodBody(), { title: TITLE, serpSubtopics: ['burr grinder', 'water temperature'] });
    expect(v.issues.some((i) => i.startsWith('SERP_GAP'))).toBe(true);
    expect(v.stats.serp_gap_count).toBe(2);
  });

  it('raises no SERP gap when subtopics are absent', () => {
    const v = validatePost(goodBody(), { title: TITLE });
    expect(v.issues.some((i) => i.startsWith('SERP_GAP'))).toBe(false);
    expect(v.stats.serp_gap_count).toBe(0);
  });
});
