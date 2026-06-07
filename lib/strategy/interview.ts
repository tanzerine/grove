/**
 * Owner interview — the questions Grove asks the business owner so the
 * strategy reflects their actual intent, not just inferred-from-web guesses.
 *
 * We deliberately keep it short. Five questions, each one a forced choice
 * with a free-text escape hatch. Owners don't have time for a 30-field form.
 *
 * Everything here is optional — `build.ts` falls back to inferred values
 * for any question the owner skipped.
 */

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
    prompt: 'What does the blog need to do for the business this month?',
    kind: 'single',
    options: [
      'drive trial signups / conversions',
      'capture organic search traffic',
      'build authority with a specific audience',
      'support sales / partnerships',
      'keep customers engaged after signup',
    ],
  },
  {
    id: 'primary_kpi',
    prompt: 'What\'s the single number you\'d most like to move?',
    kind: 'single',
    options: [
      'product signups from blog',
      'organic search sessions',
      'newsletter subscriptions',
      'inbound demo requests',
      'time-on-page / read-through',
    ],
  },
  {
    id: 'audience_focus',
    prompt: 'Who specifically do you want each article to land with? (pick up to 2)',
    help: 'These become the lens every example, anecdote, and CTA is written for.',
    kind: 'multi',
    options: [
      'founders / solo product owners',
      'product designers',
      'engineering managers / tech leads',
      'marketing / growth ops',
      'agencies & freelancers',
      'enterprise buyers',
      'individual consumers',
    ],
  },
  {
    id: 'conversion_offer',
    prompt: 'What\'s the concrete next-step you want a conversion-intent article to push?',
    help: 'Used verbatim by the manager agent when grading CTAs.',
    kind: 'text',
  },
  {
    id: 'off_limits',
    prompt: 'Any topics, competitors, or framings the blog should never touch?',
    help: 'Name competitors explicitly — they become a hard do-not-mention list for the writer + validator.',
    kind: 'text',
  },

  // ── VOICE (optional, but this is what makes the blog sound like YOU) ──────
  {
    id: 'voice_samples',
    prompt: 'Paste 1–2 posts (or URLs) that already sound exactly like your brand.',
    help: 'The single biggest lever on voice. The writer is few-shot anchored on these real excerpts — not on guesses from your landing page.',
    kind: 'text',
  },
  {
    id: 'first_person',
    prompt: 'Who is the article narrator?',
    help: 'Drives the opening hook and every "I/we" in the piece.',
    kind: 'single',
    options: [
      'a named person ("I", a founder/author with a byline)',
      'the company ("we", collective voice)',
      'no first person (third-person, editorial)',
    ],
  },
  {
    id: 'voice_attributes',
    prompt: 'Pick the 2–3 attributes that most define how you sound.',
    help: 'Each becomes a we-are / we-are-not rule the writer and brand-review grade against.',
    kind: 'multi',
    options: [
      'casual & conversational (not formal/institutional)',
      'peer-level & collaborative (not authoritative/expert-down)',
      'direct & matter-of-fact (not warm/effusive)',
      'technical & precise (not simplified/hand-wavy)',
      'bold & energetic (not calm/measured)',
      'playful & witty (not serious/earnest)',
      'opinionated & forward-looking (not neutral/established)',
    ],
  },
  {
    id: 'words_to_avoid',
    prompt: 'Words, phrases, or clichés you\'d never say.',
    help: 'Merged into the banned-phrase list for this brand specifically.',
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
