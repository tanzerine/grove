/**
 * Customer→owner feedback: the vocabulary, shared by the form, the owner
 * email, the admin inbox and the landing page. Pure and client-safe — no DB,
 * no env, no secrets — so the label a customer picks is the same string the
 * owner reads and the same string the analytics group by.
 *
 * Three doors, one inbox (see migration 0034):
 *
 *   testimonial  — it worked; may we quote you
 *   shortcoming  — it fell short; what's missing
 *   complaint    — something is wrong and you want a human
 *
 * The split is by what the OWNER has to do next — publish it, plan it, or
 * answer it — not by sentiment, which is why "shortcoming" and "complaint" are
 * separate doors despite both being criticism. A beta tester listing three
 * rough edges is not filing three complaints, and treating it as one buries the
 * customer who genuinely needs a reply.
 */

export type FeedbackKind = 'testimonial' | 'shortcoming' | 'complaint';

export type FeedbackKindConfig = {
  kind: FeedbackKind;
  /** Nav/tab label. */
  label: string;
  /** One line under the tab: what this door is for. */
  blurb: string;
  /** The question actually asked above the textarea. */
  prompt: string;
  /** Placeholder — a worked example beats an empty box every time. */
  placeholder: string;
  /** Submit button. */
  cta: string;
  /** Confirmation headline. */
  thanks: string;
  /** Confirmation body. */
  thanksBody: string;
};

/**
 * Ordered as the tabs render. Testimonial first is deliberate: a beta tester
 * arriving pleased should hit the shortest path to a quote we can use, and
 * someone arriving annoyed will not be deterred by one extra tab.
 */
export const FEEDBACK_KINDS: FeedbackKindConfig[] = [
  {
    kind: 'testimonial',
    label: 'Leave a testimonial',
    blurb: 'Grove earned its keep — say so, and we may quote you.',
    prompt: 'What has Grove actually done for you?',
    placeholder:
      "We went from publishing nothing to three posts a week without me touching a draft. Two of them are on page one now.",
    cta: 'Send testimonial',
    thanks: 'Thank you — genuinely',
    thanksBody:
      "That's the kind of thing that makes the next person try us. If you agreed to be quoted, we'll only ever use the words you wrote.",
  },
  {
    kind: 'shortcoming',
    label: 'Tell us what fell short',
    blurb: "The point of a beta. What's missing, clumsy, or not worth paying for yet.",
    prompt: "What's missing, or what did Grove get wrong?",
    placeholder:
      "The drafts read well but they don't sound like us yet — I rewrite the intro every time. And I can't schedule a post for a specific hour.",
    cta: 'Send feedback',
    thanks: 'Noted — thank you',
    thanksBody:
      "This goes straight to the person who builds Grove, not a queue. Blunt beta feedback is the most useful thing we get.",
  },
  {
    kind: 'complaint',
    label: 'Make a complaint',
    blurb: 'Something is wrong and you want a human to answer for it.',
    prompt: 'What went wrong?',
    placeholder:
      "Grove published a post with a factual error about our pricing and it sat live on our domain for two days.",
    cta: 'Send to the owner',
    thanks: 'This is with the owner',
    thanksBody:
      "It's been sent directly to Grove's owner, not a support queue. You'll get a reply at your account email.",
  },
];

export const FEEDBACK_KIND_IDS = FEEDBACK_KINDS.map((k) => k.kind);

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return typeof v === 'string' && (FEEDBACK_KIND_IDS as string[]).includes(v);
}

export function kindConfig(kind: FeedbackKind): FeedbackKindConfig {
  return FEEDBACK_KINDS.find((k) => k.kind === kind) ?? FEEDBACK_KINDS[1];
}

export function kindLabel(kind: string | null | undefined): string {
  if (!isFeedbackKind(kind)) return '—';
  return { testimonial: 'Testimonial', shortcoming: 'Shortcoming', complaint: 'Complaint' }[kind];
}

/* ─────────────────────────────── areas ──────────────────────────────────── */

/**
 * Which part of the product this is about. Coarse on purpose: fine-grained
 * options make people pick "other", and the free text says what a taxonomy
 * never could. These exist so the owner can see "six people said content
 * quality" without reading six paragraphs.
 */
export type FeedbackArea = { code: string; label: string };

export const FEEDBACK_AREAS: FeedbackArea[] = [
  { code: 'content_quality', label: 'The writing itself' },
  { code: 'topics', label: 'What it chose to write about' },
  { code: 'brand_voice', label: "Sounding like us" },
  { code: 'setup', label: 'Setup — domain, onboarding' },
  { code: 'publishing', label: 'Publishing & scheduling' },
  { code: 'embed', label: 'Embed / blog on my site' },
  { code: 'analytics', label: 'Analytics & reporting' },
  { code: 'speed', label: 'Speed — too slow, or stuck' },
  { code: 'billing', label: 'Billing & plans' },
  { code: 'other', label: 'Something else' },
];

export const FEEDBACK_AREA_CODES = FEEDBACK_AREAS.map((a) => a.code);

export function areaLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FEEDBACK_AREAS.find((a) => a.code === code)?.label ?? code;
}

/* ──────────────────────────── severity & status ─────────────────────────── */

export type FeedbackSeverity = 'blocker' | 'major' | 'minor';

export const FEEDBACK_SEVERITIES: { code: FeedbackSeverity; label: string; hint: string }[] = [
  { code: 'blocker', label: 'Blocking me', hint: "I can't use Grove until this is fixed" },
  { code: 'major', label: 'Serious', hint: 'It works, but this is costing me real time or trust' },
  { code: 'minor', label: 'Annoying', hint: 'Worth telling you, not urgent' },
];

export const FEEDBACK_SEVERITY_CODES = FEEDBACK_SEVERITIES.map((s) => s.code);

export function severityLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FEEDBACK_SEVERITIES.find((s) => s.code === code)?.label ?? code;
}

export type FeedbackStatus =
  | 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'wont_fix' | 'dismissed';

export const FEEDBACK_STATUSES: { code: FeedbackStatus; label: string }[] = [
  { code: 'new', label: 'New' },
  { code: 'acknowledged', label: 'Acknowledged' },
  { code: 'in_progress', label: 'Working on it' },
  { code: 'resolved', label: 'Resolved' },
  { code: 'wont_fix', label: "Won't fix" },
  { code: 'dismissed', label: 'Dismissed' },
];

export const FEEDBACK_STATUS_CODES = FEEDBACK_STATUSES.map((s) => s.code);

export function isFeedbackStatus(v: unknown): v is FeedbackStatus {
  return typeof v === 'string' && (FEEDBACK_STATUS_CODES as string[]).includes(v);
}

export function statusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FEEDBACK_STATUSES.find((s) => s.code === code)?.label ?? code;
}

/** Statuses that still need the owner to do something. Drives the nav badge. */
const OPEN_STATUSES = new Set<string>(['new', 'acknowledged', 'in_progress']);

export function isOpen(status: string | null | undefined): boolean {
  return OPEN_STATUSES.has(status ?? 'new');
}

/* ───────────────────────────── field limits ─────────────────────────────── */

/**
 * Shared by the client (maxLength, live counter) and the server (zod). One
 * source, so a customer can never be allowed to type 4,000 characters into a
 * box the API will reject — losing the message they took the trouble to write.
 */
export const FEEDBACK_LIMITS = {
  body: 4000,
  headline: 140,
  displayName: 80,
  displayRole: 120,
  displayUrl: 200,
  ownerNote: 4000,
} as const;

/** Minimum that counts as a message. Below this it's a mis-click, not feedback. */
export const FEEDBACK_MIN_BODY = 10;

/* ───────────────────────────── triage ordering ──────────────────────────── */

/**
 * Sort weight for the owner's inbox: what should be looked at first.
 *
 * A blocking complaint outranks everything; testimonials sit at the bottom
 * because nothing breaks if one waits a day. Within a tier the API orders by
 * recency, so this only has to get the tiers right.
 */
export function triageRank(row: {
  kind?: string | null;
  severity?: string | null;
  status?: string | null;
}): number {
  if (!isOpen(row.status)) return 100;
  if (row.kind === 'complaint') {
    if (row.severity === 'blocker') return 0;
    if (row.severity === 'major') return 1;
    return 2;
  }
  if (row.kind === 'shortcoming') return 3;
  return 4;
}

/* ─────────────────────────── published testimonials ─────────────────────── */

export type TestimonialRow = {
  body?: string | null;
  headline?: string | null;
  rating?: number | null;
  display_name?: string | null;
  display_role?: string | null;
  display_url?: string | null;
};

export type Testimonial = {
  quote: string;
  name: string;
  role: string;
  url: string | null;
  /** Uppercase initials for the avatar chip. */
  initials: string;
  rating: number | null;
};

/**
 * Shape a stored testimonial for public display.
 *
 * Falls back to "A Grove customer" rather than dropping the credit: a quote
 * with no attribution at all reads as invented, which is the exact impression
 * real testimonials exist to avoid. `display_url` is only carried through when
 * it's http(s) — a stored `javascript:` value must never reach an href.
 */
export function toTestimonial(row: TestimonialRow): Testimonial {
  const name = (row.display_name ?? '').trim() || 'A Grove customer';
  const quote = (row.headline ?? '').trim() || (row.body ?? '').trim();
  return {
    quote,
    name,
    role: (row.display_role ?? '').trim(),
    url: safeUrl(row.display_url),
    initials: initialsOf(name),
    rating: typeof row.rating === 'number' && row.rating >= 1 && row.rating <= 5 ? row.rating : null,
  };
}

function safeUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return 'G';
  return parts.map((p) => [...p][0]?.toUpperCase() ?? '').join('') || 'G';
}
