/**
 * Fact-grounding check — the one gate the writing model can't grade itself on.
 *
 * A numeric claim (percentage, currency, multiplier, large count) is the
 * highest-risk thing an LLM writer ships: a fabricated stat under the
 * customer's byline on the customer's domain. The E-E-A-T rules already tell
 * the writer "every numeric claim must include a primary-source URL", but
 * until now nothing *verified* it — the manager is the same model family and
 * scores its own homework.
 *
 * This check is deterministic: a claim counts as supported when its sentence
 * (or the surrounding paragraph) carries an inline markdown citation, or when
 * the number itself appears in the research corpus the writer was given.
 * Anything else is flagged UNSUPPORTED_CLAIM and routes the draft to human
 * review instead of auto-publish.
 */

export type NumericClaim = { token: string; sentence: string };

/** Patterns that make a number "claim-y". Deliberately conservative:
 *  bare small integers ("3 ways", "step 2") and years are NOT claims. */
const CLAIM_PATTERNS: RegExp[] = [
  /\d+(?:\.\d+)?\s?%/,                                  // 85%, 12.5 %
  /[$€£₩]\s?\d[\d,]*(?:\.\d+)?[kKmMbB]?/,               // $4,000 / €12 / $3.5k
  /\b\d+(?:\.\d+)?\s?[x×]\b/i,                          // 2.5x / 3 ×
  /\b\d+(?:\.\d+)?\s+times\b/i,                         // "4 times more"
  /\b\d{1,3}(?:,\d{3})+\b/,                             // 10,000 / 1,200,000
  /\b\d+(?:\.\d+)?\s?(?:million|billion|trillion)\b/i,  // 4.5 million
];

const INLINE_LINK = /\[[^\]]+\]\(https?:\/\/[^)]+\)/;

/** Strip the parts of markdown where numbers are never factual claims:
 *  fenced code, inline code, headings, image/link URLs (kept link text). */
function proseOnly(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .split('\n')
    .filter((l) => !/^#{1,6}\s/.test(l))
    .join('\n');
}

/** Normalize a numeric token for corpus lookup: "10,000" → "10000", "85 %" → "85%". */
function corpusKey(token: string): string {
  return token.toLowerCase().replace(/[\s,]/g, '');
}

function matchTokens(sentence: string): string[] {
  const out: string[] = [];
  for (const re of CLAIM_PATTERNS) {
    const m = sentence.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (m) out.push(...m);
  }
  return out;
}

/**
 * Find numeric claims with no visible support.
 *
 * @param md            the draft body (markdown)
 * @param researchText  concatenated titles + snippets of every research source
 *                      the writer saw (empty string = only citations can support)
 */
export function findUnsupportedClaims(md: string, researchText: string): NumericClaim[] {
  const corpus = corpusKey(researchText);
  const claims: NumericClaim[] = [];
  const seen = new Set<string>();

  for (const paragraph of proseOnly(md).split(/\n{2,}/)) {
    const paragraphCited = INLINE_LINK.test(paragraph);
    for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
      const tokens = matchTokens(sentence);
      if (!tokens.length) continue;
      // a citation in the sentence (or same paragraph) supports every number in it
      if (INLINE_LINK.test(sentence) || paragraphCited) continue;
      for (const token of tokens) {
        const key = corpusKey(token);
        if (seen.has(key)) continue;
        if (corpus && corpus.includes(key)) continue;   // number came from research
        seen.add(key);
        claims.push({ token: token.trim(), sentence: sentence.trim().slice(0, 160) });
      }
    }
  }
  return claims;
}
