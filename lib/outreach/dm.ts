/**
 * The DM draft — pure, client-safe, no network.
 *
 * A cold DM has about two sentences to prove it was written for one person.
 * Everything here exists to make those two sentences carry the author's own
 * words: the opener quotes the sentence the screen scored on, and the bridge is
 * selected by the pain that fired, so a post about quitting a blog and a post
 * about agency pricing never get the same paragraph.
 *
 * WHAT CHANGED FROM THE HAND-WRITTEN VERSION, and why:
 *
 *  1. There is a SUBJECT. Reddit DMs have one and it is the whole preview —
 *     an empty or generic subject is the single cheapest way to not get read.
 *  2. Two compliments became one. The original both asked for feedback and
 *     told them "you clearly think hard about this"; one compliment reads
 *     sincere, two read like a technique. Drafts land at 150–163 words — the
 *     code and the link cost words the original didn't spend — and the opener's
 *     quote is length-capped so nothing else can run away.
 *  3. The code is IN the message. The original's only next step was "reply",
 *     which costs the reader a round-trip and costs you the ones who were
 *     curious but not curious enough to write back. Code plus link means an
 *     interested stranger can act without talking to you; the reply ask stays
 *     for the ones who want a human.
 *  4. The honest line is kept almost verbatim — "it won't get you a customer
 *     this month" is the best sentence in the original. It is the only line
 *     that proves you are not running a numbers game, and it is why the ask
 *     ("tell me where it's wrong") is credible.
 *
 * The composer never sends anything. It returns text a human reads, edits and
 * pastes — see the admin page. That is a design decision, not a missing
 * feature: automated sending is what turns outreach into spam, and the review
 * step is the only thing standing between a scored regex and a real person.
 */
import type { PainKind, Prospect, Screen, RedditPost } from './screen';

/**
 * Past this the DM reads as a pitch deck. Warned on, not enforced.
 *
 * Set just above what the template can produce at its longest (a ~128-word
 * fixed spine plus a capped opener lands at 150–163), so the warning means
 * "something unusual happened here" — in practice, a model that answered with a
 * paragraph. A threshold that fired on every ordinary draft would be ignored,
 * which is worse than not having one.
 */
export const DM_MAX_WORDS = 165;
/** Below this there isn't enough of them in it to be worth sending. */
export const DM_MIN_WORDS = 55;

export type CouponOffer = {
  /** Normalised code, e.g. GROVEBETA. */
  code: string;
  /** Posts per month the grant allows. */
  postsQuota: number;
  /** Days of access from redemption. */
  days: number;
  /** Where to redeem it — absolute URL. */
  url: string;
};

export type DmOptions = {
  /** How you sign off. */
  senderName: string;
  coupon?: CouponOffer | null;
};

export type DmDraft = {
  subject: string;
  body: string;
  words: number;
  /** Things to fix before sending. Never blocks — the human decides. */
  warnings: string[];
  /** Which bridge fired, so the UI can show why this draft differs. */
  angle: PainKind | 'generic';
};

/* ─────────────────────────────── the copy ────────────────────────────────── */

/**
 * The second paragraph, chosen by the pain the screen found.
 *
 * Each one says something true about the channel rather than about the product.
 * That ordering is deliberate: the reader has to agree with a sentence before
 * they will read the one that mentions your company.
 */
const BRIDGE: Record<PainKind | 'generic', string> = {
  no_time:
    "SEO is the one channel that's repetitive to do and invisible for months. That combination loses to everything else on the calendar every week — it isn't a discipline problem.",
  quit_content:
    "Nearly everyone I talk to has four posts from a burst of enthusiasm last year. Stopping is the normal outcome — by hand it just isn't a loop anyone sustains.",
  distribution:
    "SEO is the worst offender there: repetitive, slow, and the outcome may never be visible at all. Hard to keep choosing over work you can watch land the same day.",
  seo_slow:
    "The lag is the whole problem. Nothing tells you it's working until it suddenly is, so most people quit around month two — right before the part that compounds.",
  no_traffic:
    "Usually the gap isn't the product — it's that there's nothing out there for anyone to land on. Search is slow, but it keeps working after you stop watching it.",
  agency_cost:
    "Most of what an agency bills for is a person doing repetitive work on a schedule. That's the part I don't think should cost what it costs.",
  generic:
    "SEO is the channel everyone knows they should run and almost nobody sustains — repetitive to do, and invisible for months before it pays.",
};

/** Short, lowercase, specific. It is the entire preview the reader sees. */
const SUBJECT: Record<PainKind | 'generic', string> = {
  no_time: 'the blog you have no time to write',
  quit_content: 'about the blog that stopped',
  distribution: 're: building vs. distributing',
  seo_slow: 'the slow part of SEO',
  no_traffic: 're: shipping to crickets',
  agency_cost: 're: what the agency quoted you',
  generic: 're: your post',
};

const PRODUCT =
  "I'm building Grove — it researches, writes and publishes to your own domain on autopilot, so that channel keeps running while your hours go to the uncomfortable stuff that needs you in the room.";

// "Honest version:" earns its two words — it labels the sentence as the one
// that costs the sender something, which is the only reason a stranger believes
// the rest of the message.
const HONESTY =
  "Honest version: it won't get you a paying customer this month — SEO doesn't move that fast. What I want is someone who'll tell me where it's wrong.";

/* ────────────────────────────── composition ──────────────────────────────── */

/**
 * Build the draft for one screened prospect.
 *
 * Deterministic — same prospect, same draft. The LLM pass (personalize.ts) only
 * ever rewrites the opener on top of this, and falls back to it, so there is
 * always a sendable draft even with no model, no token and no network.
 */
export function composeDm(prospect: Prospect, opts: DmOptions): DmDraft {
  const { post, screen } = prospect;
  const angle: PainKind | 'generic' = screen.pain ?? 'generic';
  const warnings: string[] = [];

  const quote = openerQuote(screen);
  const opener = quote
    ? `Saw your post in r/${post.subreddit} — "${quote}". That's the bit I keep coming back to.`
    : `Saw your post in r/${post.subreddit} — "${trim(post.title, 110)}".`;
  if (!quote) {
    warnings.push(
      "No quotable line matched, so the opener only names the title. Write the first sentence yourself before sending — the title alone reads like a mail merge.",
    );
  }

  const paragraphs = [opener, BRIDGE[angle], PRODUCT, HONESTY];

  if (opts.coupon) {
    const { code, postsQuota, days, url } = opts.coupon;
    paragraphs.push(
      `Free beta if you want it: sign up at ${url}, code ${code} under Billing — ${postsQuota} posts a month for ${days} days, no card. ` +
        `Or just reply and I'll send you one it wrote for your site.`,
    );
  } else {
    warnings.push('No coupon attached — the message asks for a reply with nothing to act on.');
    paragraphs.push(
      "Free beta, no card, nothing to cancel. Reply and I'll send you a post it wrote for your site, and you can tell me if it's any good.",
    );
  }

  paragraphs.push(`— ${opts.senderName}`);

  const body = paragraphs.join('\n\n');
  const words = wordCount(body);

  warnings.push(...lengthWarnings(words));
  warnings.push(...sendWarnings(screen, post));

  return { subject: SUBJECT[angle], body, words, warnings, angle };
}

/**
 * Length complaints, as their own function so the LLM path can recompute them.
 *
 * personalize.ts replaces paragraph one and MUST re-run this: the deterministic
 * warning was measured against the old opener, and a model that answered with a
 * paragraph instead of a sentence is exactly the case a length warning is for.
 * Every string here is recognised by `isLengthWarning`, so the stale ones can be
 * dropped without dropping the send warnings alongside them.
 */
export function lengthWarnings(words: number): string[] {
  if (words > DM_MAX_WORDS) {
    return [`${words} words — past ~${DM_MAX_WORDS} it reads as a pitch. Cut the bridge paragraph.`];
  }
  if (words < DM_MIN_WORDS) return [`${words} words — too thin to carry the ask.`];
  return [];
}

/** True for anything `lengthWarnings` produced. */
export function isLengthWarning(w: string): boolean {
  return /^\d+ words —/.test(w);
}

/**
 * Reasons to hesitate that come from the screen rather than the prose.
 *
 * Hard blockers are surfaced here as well as on the card because this is the
 * last thing read before the copy button, and a draft that exists at all is a
 * quiet argument for sending it.
 */
function sendWarnings(screen: Screen, post: RedditPost): string[] {
  const out: string[] = [];
  for (const b of screen.blockers) {
    if (b.hard) out.push(`DO NOT SEND — ${b.label}${b.quote ? `: "${trim(b.quote, 120)}"` : ''}.`);
  }
  if (screen.tier === 'worth_a_look') {
    out.push('Borderline fit — read the post before you send this, not just the quote.');
  }
  // Every subreddit has its own line on unsolicited DMs, and none of them are
  // knowable from the post JSON. Saying so once beats silently implying it's fine.
  out.push(`Check r/${post.subreddit}'s rules on DMing members before you send.`);
  return out;
}

/**
 * The line the opener quotes.
 *
 * Pain evidence only — a fit signal like "my saas" is true but says nothing
 * back to them, and quoting it makes the opener sound like you skimmed. Better
 * no quote (and a warning) than a quote that proves you didn't read.
 */
function openerQuote(screen: Screen): string | null {
  const painKeys = new Set<string>(screen.pains);
  const hit = screen.evidence.find((e) => painKeys.has(e.key));
  if (!hit) return null;
  // The cap is a LENGTH BUDGET, not neatness. The rest of the message is a
  // fixed ~130 words, so the quote is the only part that can push a draft past
  // DM_MAX_WORDS — and body sentences run long. Capped in WORDS, because that
  // is the unit the budget is in: 105 characters of short words is 24 of them,
  // which is how this overran the ceiling the first time.
  // Trailing sentence punctuation goes because the opener supplies its own;
  // `"…the same day.". That's` is the giveaway that a template wrote this.
  const q = trim(trimWords(hit.quote, MAX_QUOTE_WORDS), 130).replace(/[.,;:]+$/, '');
  // A four-word fragment quoted back reads like a search hit, not like reading.
  return wordCount(q) >= 5 ? q : null;
}

/**
 * The opener's share of the word budget.
 *
 * 18 words plus the 13 of surrounding sentence leaves the fixed ~130-word spine
 * comfortably inside DM_MAX_WORDS. Long enough to still be a whole thought of
 * theirs rather than a keyword fragment.
 */
const MAX_QUOTE_WORDS = 18;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function trimWords(s: string, maxWords: number): string {
  const words = s.replace(/\s+/g, ' ').trim().split(' ');
  return words.length <= maxWords ? s : `${words.slice(0, maxWords).join(' ')}…`;
}

function trim(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
