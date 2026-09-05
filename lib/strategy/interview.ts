/**
 * Owner interview — the questions Grove asks the business owner so the
 * strategy reflects their actual intent, not just inferred-from-web guesses.
 *
 * We deliberately keep it short. Five questions, each one a forced choice
 * with a free-text escape hatch. Owners don't have time for a 30-field form.
 *
 * Everything here is optional — `build.ts` falls back to inferred values
 * for any question the owner skipped.
 *
 * ── Why the English is wrapped in `msg` ───────────────────────────────────
 * This table is module-level, so it is built once per process and cannot call
 * `t` — it would freeze whichever locale loaded the module first. It holds the
 * English and /onboarding/intent translates at the render site; `msg` is the
 * identity function that makes the strings visible to the extractor in
 * tests/i18n-coverage.test.ts.
 *
 * The OPTION strings are also the stored ANSWERS: `interviewSummary` prints
 * them straight into the strategist's prompt, and the answers of a Korean and
 * an English customer have to mean the same thing to it. So the value stays
 * English in the database and only the display is translated.
 */
import { msg } from '../i18n';

export type InterviewQuestion = {
  id: string;
  prompt: string;
  help?: string;
  kind: 'single' | 'multi' | 'text';
  options?: string[];        // omit for free-text
  required?: boolean;
};

export type InterviewAnswer = {
  id: string;
  value: string | string[];
};

export type InterviewAnswers = Record<string, InterviewAnswer['value']>;

export const INTERVIEW: InterviewQuestion[] = [
  {
    id: 'primary_goal',
    prompt: msg('What does the blog need to do for the business this month?'),
    kind: 'single',
    options: [
      msg('drive trial signups / conversions'),
      msg('capture organic search traffic'),
      msg('build authority with a specific audience'),
      msg('support sales / partnerships'),
      msg('keep customers engaged after signup'),
    ],
  },
  {
    id: 'primary_kpi',
    prompt: msg('What\'s the single number you\'d most like to move?'),
    kind: 'single',
    options: [
      msg('product signups from blog'),
      msg('organic search sessions'),
      msg('newsletter subscriptions'),
      msg('inbound demo requests'),
      msg('time-on-page / read-through'),
    ],
  },
  {
    id: 'audience_focus',
    prompt: msg('Who specifically do you want each article to land with? (pick up to 2)'),
    help: msg('These become the lens every example, anecdote, and CTA is written for.'),
    kind: 'multi',
    options: [
      msg('founders / solo product owners'),
      msg('product designers'),
      msg('engineering managers / tech leads'),
      msg('marketing / growth ops'),
      msg('agencies & freelancers'),
      msg('enterprise buyers'),
      msg('individual consumers'),
    ],
  },
  {
    id: 'conversion_offer',
    prompt: msg('What\'s the concrete next-step you want a conversion-intent article to push?'),
    help: msg('Used verbatim by the manager agent when grading CTAs.'),
    kind: 'text',
  },
  {
    id: 'off_limits',
    prompt: msg('Any topics, competitors, or framings the blog should never touch?'),
    help: msg('Name competitors explicitly — they become a hard do-not-mention list for the writer + validator.'),
    kind: 'text',
  },

  // ── VOICE (optional, but this is what makes the blog sound like YOU) ──────
  {
    id: 'voice_samples',
    prompt: msg('Paste 1–2 posts (or URLs) that already sound exactly like your brand.'),
    help: msg('The single biggest lever on voice. The writer is few-shot anchored on these real excerpts — not on guesses from your landing page.'),
    kind: 'text',
  },
  {
    id: 'first_person',
    prompt: msg('Who is the article narrator?'),
    help: msg('Drives the opening hook and every "I/we" in the piece.'),
    kind: 'single',
    options: [
      msg('a named person ("I", a founder/author with a byline)'),
      msg('the company ("we", collective voice)'),
      msg('no first person (third-person, editorial)'),
    ],
  },
  {
    id: 'voice_attributes',
    prompt: msg('Pick the 2–3 attributes that most define how you sound.'),
    help: msg('Each becomes a we-are / we-are-not rule the writer and brand-review grade against.'),
    kind: 'multi',
    options: [
      msg('casual & conversational (not formal/institutional)'),
      msg('peer-level & collaborative (not authoritative/expert-down)'),
      msg('direct & matter-of-fact (not warm/effusive)'),
      msg('technical & precise (not simplified/hand-wavy)'),
      msg('bold & energetic (not calm/measured)'),
      msg('playful & witty (not serious/earnest)'),
      msg('opinionated & forward-looking (not neutral/established)'),
    ],
  },
  {
    id: 'words_to_avoid',
    prompt: msg('Words, phrases, or clichés you\'d never say.'),
    help: msg('Merged into the banned-phrase list for this brand specifically.'),
    kind: 'text',
  },
];

/** Parse stored interview answers into a typed record. */
export function parseInterview(raw: unknown): InterviewAnswers | null {
  if (!raw || typeof raw !== 'object') return null;
  return raw as InterviewAnswers;
}

/** Best-effort string summary for inclusion in LLM prompts. */
export function interviewSummary(answers: InterviewAnswers | null): string {
  if (!answers) return '(no owner interview on file — infer from site data)';
  return INTERVIEW.map((q) => {
    const v = answers[q.id];
    if (v == null || (Array.isArray(v) && v.length === 0)) return null;
    const printed = Array.isArray(v) ? v.join(', ') : String(v);
    return `- ${q.prompt}\n  → ${printed}`;
  })
    .filter(Boolean)
    .join('\n');
}
