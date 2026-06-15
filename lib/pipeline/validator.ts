import { BANNED_PHRASES, RECYCLED_STATS } from './quality-rules';
import { extractFaq } from '../faq';

export type Validation = { passed: boolean; issues: string[]; stats: Record<string, number> };

export type ValidateOpts = {
  /** Canonical title (brief.title / meta_title). When given, we enforce H1 == title. */
  title?: string;
  /** Funnel position — gates CTA / brand-link expectations. */
  intent?: 'editorial' | 'contextual' | 'conversion';
  /** Word-count floor. Drafts under this are flagged THIN. Default 800. */
  wordFloor?: number;
  /** Word-count ceiling. Default 1900 (body + a short FAQ). */
  wordCeiling?: number;
};

/** Phrases that send the reader to a competitor, alternative tool, or third party.
 *  Name-agnostic on purpose: catches the *behavior* (referring away) regardless of
 *  which competitor surfaced in research. This is what shipped on oveners.com:
 *  "tools like 3D AI Studio", "platforms like Venngage", "partner with agencies". */
const REFERRAL_AWAY = [
  /\bpartner with (?:an? )?(?:agenc|studio|freelanc|vendor)/i,
  /\bagencies offering\b/i,
  /\b(?:tools|platforms|apps|services|alternatives) like \w+/i,
  /\byou (?:can|could) also (?:use|try)\b/i,
  /\balternatively,? (?:you can |you could )?(?:use|try)\b/i,
  /\b(?:hire|outsource to) (?:a|an)\b/i,
];

function firstH1(post: string): string | null {
  for (const line of post.split('\n')) {
    const m = line.match(/^#\s+(.*\S)\s*$/);
    if (m) return m[1].trim();
  }
  return null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function validatePost(post: string, opts: ValidateOpts = {}): Validation {
  const issues: string[] = [];
  const lower = post.toLowerCase();
  const { intent, wordFloor = 800, wordCeiling = 1900 } = opts;

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
  // 2-4 citations is the sweet spot — selective evidence, not link-stuffed
  if (citations < 2) issues.push(`LOW_CITATIONS: ${citations} markdown links (target 2–4)`);
  if (citations > 5) issues.push(`OVER_CITED: ${citations} markdown links (target 2–4 — fewer, more selective)`);

  for (const s of RECYCLED_STATS) if (lower.includes(s.toLowerCase())) issues.push(`RECYCLED_STAT: '${s}'`);

  // ── word-count gate: thin posts are the #1 quality failure observed ──────
  const wordCount = post.split(/\s+/).filter(Boolean).length;
  if (wordCount < wordFloor) issues.push(`THIN_CONTENT: ${wordCount} words (floor ${wordFloor}, target 900–1400)`);
  if (wordCount > wordCeiling) issues.push(`OVERLONG: ${wordCount} words (ceiling ${wordCeiling})`);

  // ── FAQ section: powers FAQPage schema + AI-answer extraction (AEO/GEO) ──
  const faqs = extractFaq(post);
  if (faqs.length < 2)
    issues.push(`MISSING_FAQ: ${faqs.length} Q&A pairs under a "## FAQ" heading (target 2–4 — drives FAQ schema + AI answers)`);

  // ── H1 / title sync: the on-page H1 must match the canonical title ───────
  // (oveners.com shipped 4/4 posts whose H1 differed entirely from the slug/title.)
  const h1 = firstH1(post);
  if (!h1) {
    issues.push('MISSING_H1: no `# ` heading found');
  } else if (opts.title && norm(h1) !== norm(opts.title)) {
    issues.push(`TITLE_H1_MISMATCH: H1 "${h1}" ≠ title "${opts.title}"`);
  }

  // ── referral-away: never send the reader to a competitor or agency ──────
  for (const re of REFERRAL_AWAY) {
    const m = post.match(re);
    if (m) { issues.push(`REFERRAL_AWAY: '${m[0]}' (don't recommend competitors / third parties)`); break; }
  }

  // ── intent ↔ brand-link consistency ─────────────────────────────────────
  // editorial pieces must not link to the homepage; conversion must. The body
  // here doesn't know the host, so brand-link enforcement stays in the manager
  // (intent_editorial / intent_conversion rules). `intent` is surfaced in stats
  // so the review UI can show what funnel position was graded against.
  void intent;

  return {
    passed: issues.length === 0,
    issues,
    stats: {
      word_count: wordCount,
      sentence_count: sents.length,
      em_dash_count: em,
      citation_count: citations,
      faq_count: faqs.length,
    },
  };
}
