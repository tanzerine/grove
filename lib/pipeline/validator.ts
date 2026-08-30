import { BANNED_PHRASES, RECYCLED_STATS, phraseBoundaryRe } from './quality-rules';
import { extractFaq } from '../faq';
import { extractTakeaways } from '../takeaways';
import { coverageGap } from './serp';
import { findUnsupportedClaims } from './claims';
import { language, contentLength, splitSentences, languageVerdict, type LangCode } from '../language';

export type Validation = { passed: boolean; issues: string[]; stats: Record<string, number> };

/** Rules serious enough to block auto-publish and route the draft to human
 *  review. Style flags (LOW_CITATIONS, EM_DASH_OVERUSE, …) stay advisory —
 *  gating on those would send everything to review and kill autopilot.
 *
 *  THIN_CONTENT used to be here and was doing exactly that. The writer is
 *  briefed to land 900–1400 words and habitually comes in just under the 800
 *  floor: on the one domain running autopilot, 29 of 32 drafts carried the
 *  flag, and 790-words-against-a-800-floor gated an article the manager had
 *  scored 81. Because the gate is evaluated once, at generation time, every
 *  one of those became a permanent hold — that domain routed 32 drafts to
 *  `review` and exactly 1 to `scheduled` in two months of "autopilot on".
 *  The owner then approved most of them unread, which is the tell: the flag
 *  was not protecting anyone, it was relocating the work back to a human.
 *
 *  It stays a flag — it still shows in review, still feeds the manager's
 *  rewrite notes, and a genuinely stunted draft is caught by the manager's
 *  own craft score against the owner's floor. It just no longer decides,
 *  on its own, that a finished article can't ship. */
export const BLOCKING_RULES = [
  'UNSUPPORTED_CLAIM',   // possible fabricated stat — the worst failure mode
  'RECYCLED_STAT',       // known-bogus stat the model loves to repeat
  'MISSING_H1',          // structurally broken draft
  'REFERRAL_AWAY',       // sends the reader to a competitor
  // An article in the wrong language is not a quality note, it is the wrong
  // article. grove published its first Korean-configured post in English with
  // a passing manager score; nothing else in this list would have caught it,
  // because by every other measure the draft was good.
  'WRONG_LANGUAGE',
] as const;

/** The subset of a validation's issues that must gate publication. */
export function blockingIssues(v: Validation): string[] {
  return v.issues.filter((i) => BLOCKING_RULES.some((r) => i.startsWith(r)));
}

export type ValidateOpts = {
  /** Canonical title (brief.title / meta_title). When given, we enforce H1 == title. */
  title?: string;
  /** Funnel position — gates CTA / brand-link expectations. */
  intent?: 'editorial' | 'contextual' | 'conversion';
  /** Language the draft was written in. Decides the unit length is measured
   *  in (words vs characters), the sentence terminators, and what counts as
   *  first-person experience. Default 'en'. */
  lang?: LangCode;
  /** Length floor, in the language's own unit. Defaults to the language's. */
  wordFloor?: number;
  /** Length ceiling, in the language's own unit. Defaults to the language's. */
  wordCeiling?: number;
  /** Consensus subtopics from SERP analysis — flagged if the draft skips them. */
  serpSubtopics?: string[];
  /** Concatenated titles + snippets of the research sources the writer saw.
   *  When given, numeric claims must be cited inline or appear here —
   *  otherwise they're flagged UNSUPPORTED_CLAIM (blocking). */
  researchText?: string;
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
  const lang = language(opts.lang);
  const { intent, wordFloor = lang.length.floor, wordCeiling = lang.length.ceiling } = opts;
  const [targetLo, targetHi] = lang.length.target;

  // whole-phrase only — "robustness"/"underscored" must not flag as banned
  for (const p of BANNED_PHRASES) if (phraseBoundaryRe(p).test(post)) issues.push(`BANNED_PHRASE: '${p}'`);

  const em = (post.match(/—/g) || []).length;
  if (em > 2) issues.push(`EM_DASH_OVERUSE: ${em} (max 2)`);

  // Sentence splitting and "short" are both per-language: Chinese ends
  // sentences with 。 and never a space, and a 12-WORD yardstick reads a whole
  // Korean paragraph as one long sentence.
  const sents = splitSentences(post, lang);
  if (sents.length) {
    const len = sents.map((s) => contentLength(s, lang));
    const shortPct = (len.filter((w) => w < lang.shortSentence).length / sents.length) * 100;
    if (shortPct < 30) issues.push(`LOW_SENTENCE_VARIETY: ${shortPct.toFixed(0)}% short sentences (target 40%+)`);
  }

  if (!lang.firstPerson.test(post))
    issues.push('MISSING_EXPERIENCE: no first-person experience line');

  const citations = (post.match(/\[[^\]]+\]\(https?:\/\/[^\)]+\)/g) || []).length;
  // 2-4 citations is the sweet spot — selective evidence, not link-stuffed
  if (citations < 2) issues.push(`LOW_CITATIONS: ${citations} markdown links (target 2–4)`);
  if (citations > 5) issues.push(`OVER_CITED: ${citations} markdown links (target 2–4 — fewer, more selective)`);

  for (const s of RECYCLED_STATS) if (lower.includes(s.toLowerCase())) issues.push(`RECYCLED_STAT: '${s}'`);

  // ── word-count gate: thin posts are the #1 quality failure observed ──────
  const unit = lang.length.unitLabel;
  const wordCount = contentLength(post, lang);
  if (wordCount < wordFloor) issues.push(`THIN_CONTENT: ${wordCount} ${unit} (floor ${wordFloor}, target ${targetLo}–${targetHi})`);
  if (wordCount > wordCeiling) issues.push(`OVERLONG: ${wordCount} ${unit} (ceiling ${wordCeiling})`);

  // ── language: is this even the article we asked for? ────────────────────
  // Script-based and deliberately conservative (see languageVerdict): 'unsure'
  // never flags. Blocking, so autopilot cannot ship it.
  if (languageVerdict(post, lang) === 'wrong')
    issues.push(`WRONG_LANGUAGE: this blog publishes in ${lang.englishName} (${lang.nativeName}) — the draft is not`);

  // ── FAQ section: powers FAQPage schema + AI-answer extraction (AEO/GEO) ──
  const faqs = extractFaq(post);
  if (faqs.length < 2)
    issues.push(`MISSING_FAQ: ${faqs.length} Q&A pairs under a "## ${lang.labels.faq}" heading (target 2–4 — drives FAQ schema + AI answers)`);

  // ── Key takeaways: the extractable TL;DR that AI engines + snippets quote ──
  const takeaways = extractTakeaways(post);
  if (takeaways.length < 3)
    issues.push(`MISSING_KEY_TAKEAWAYS: ${takeaways.length} bullets under a "${lang.labels.takeaways}" intro (target 3–5 — extractable summary for AI + snippets)`);

  // ── SERP coverage gap: consensus subtopics the ranking pages cover but we don't ──
  const serpGap = coverageGap(opts.serpSubtopics ?? [], post);
  if (serpGap.length)
    issues.push(`SERP_GAP: top-ranking pages cover ${serpGap.map((s) => `"${s}"`).join(', ')} — your draft doesn't`);

  // ── H1 / title sync: the on-page H1 must match the canonical title ───────
  // (oveners.com shipped 4/4 posts whose H1 differed entirely from the slug/title.)
  const h1 = firstH1(post);
  if (!h1) {
    issues.push('MISSING_H1: no `# ` heading found');
  } else if (opts.title && norm(h1) !== norm(opts.title)) {
    issues.push(`TITLE_H1_MISMATCH: H1 "${h1}" ≠ title "${opts.title}"`);
  }

  // ── fact grounding: numeric claims need a citation or a research source ──
  // Independent of the LLM manager on purpose — this is the check the writing
  // model cannot talk its way past. Capped at 3 so one noisy draft doesn't
  // drown the review UI.
  const unsupported = opts.researchText !== undefined
    ? findUnsupportedClaims(post, opts.researchText)
    : [];
  for (const c of unsupported.slice(0, 3)) {
    issues.push(`UNSUPPORTED_CLAIM: '${c.token}' — "${c.sentence}" has no inline citation and doesn't appear in any research source`);
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
      key_takeaways_count: takeaways.length,
      serp_gap_count: serpGap.length,
      unsupported_claim_count: unsupported.length,
    },
  };
}
