import { BANNED_PHRASES, RECYCLED_STATS } from './quality-rules';

export type Validation = { passed: boolean; issues: string[]; stats: Record<string, number> };

export function validatePost(post: string): Validation {
  const issues: string[] = [];
  const lower = post.toLowerCase();

  for (const p of BANNED_PHRASES) if (lower.includes(p.toLowerCase())) issues.push(`BANNED_PHRASE: '${p}'`);

  const em = (post.match(/—/g) || []).length;
  if (em > 2) issues.push(`EM_DASH_OVERUSE: ${em} (max 2)`);

  const sents = post.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  if (sents.length) {
    const wc = sents.map((s) => s.split(/\s+/).length);
    const shortPct = (wc.filter((w) => w < 12).length / sents.length) * 100;
    if (shortPct < 30) issues.push(`LOW_SENTENCE_VARIETY: ${shortPct.toFixed(0)}% short sentences (target 40%+)`);
  }

  if (!/\bI (tried|tested|ran|saw|noticed|found|built|used)\b/.test(post))
    issues.push('MISSING_EXPERIENCE: no first-person experience line');

  const citations = (post.match(/\[[^\]]+\]\(https?:\/\/[^\)]+\)/g) || []).length;
  if (citations < 3) issues.push(`LOW_CITATIONS: ${citations} markdown links (target 3+)`);

  for (const s of RECYCLED_STATS) if (lower.includes(s.toLowerCase())) issues.push(`RECYCLED_STAT: '${s}'`);

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      word_count: post.split(/\s+/).length,
      sentence_count: sents.length,
      em_dash_count: em,
      citation_count: citations,
    },
  };
}
