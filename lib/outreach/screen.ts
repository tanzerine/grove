/**
 * Reddit prospect screening — pure, no DB, no env, no network.
 *
 * The job: given a Reddit post, decide whether its author has a problem Grove
 * actually solves, and produce the EVIDENCE for that decision — the sentence
 * they wrote that says so. Everything downstream depends on that quote: it is
 * what the DM's first line references, and it is what lets the owner overrule
 * the score in two seconds instead of re-reading the post.
 *
 * WHY A SCORE AND NOT A FILTER. Cold DMs have exactly one failure mode that
 * matters, and it isn't a missed prospect — it's DMing someone the pitch
 * doesn't fit. That costs a report, a sub ban, and the reputation of the
 * product. So this module is deliberately asymmetric: pain signals *earn*
 * points slowly, and blockers are cheap and decisive. A `hard` blocker forces
 * tier 'skip' no matter how well the post scored, because "this person said
 * don't DM me" is not a number to be outweighed.
 *
 * Client-safe on purpose — the admin UI renders the same labels and the same
 * evidence the server scored on, so the screen can never show a verdict that
 * disagrees with the one that produced the draft.
 */

/* ──────────────────────────── what we're reading ─────────────────────────── */

/** One Reddit post, normalised away from the API's wire shape (see reddit.ts). */
export type RedditPost = {
  /** Reddit's base-36 id without the `t3_` prefix. Stable, used for dedupe. */
  id: string;
  subreddit: string;
  /** Username without `u/`. `[deleted]` for removed accounts. */
  author: string;
  title: string;
  /** Body text. Empty for link posts. */
  selftext: string;
  /** Absolute https URL to the post. */
  permalink: string;
  /** Unix seconds, UTC. */
  createdUtc: number;
  /** Net upvotes. */
  score: number;
  numComments: number;
  flair?: string | null;
};

/* ─────────────────────────────── the pains ───────────────────────────────── */

/**
 * The shapes of "I have the problem Grove solves".
 *
 * These are not topics — they're the five ways the same underlying complaint
 * gets written by someone who owns a domain. The kind matters beyond scoring:
 * it selects which paragraph the DM opens with (see dm.ts), so a post about
 * quitting a blog after four posts and a post about agency pricing don't get
 * the same pitch.
 */
export type PainKind =
  | 'no_traffic'
  | 'no_time'
  | 'seo_slow'
  | 'quit_content'
  | 'agency_cost'
  | 'distribution';

type PainDef = {
  kind: PainKind;
  /** Shown on the prospect card. */
  label: string;
  /** Points the strongest single match is worth. */
  weight: number;
  patterns: RegExp[];
};

/**
 * Ordered by how well Grove answers the complaint, not by how common it is.
 *
 * `no_time` and `quit_content` score highest because they describe someone who
 * has already decided SEO is worth doing and has failed to *sustain* it — which
 * is precisely and only what an autopilot fixes. `no_traffic` is more common and
 * scores lower: plenty of no-traffic posts are products nobody searches for, and
 * content won't save those.
 */
const PAINS: PainDef[] = [
  {
    kind: 'no_time',
    label: 'Knows they should publish, has no hours for it',
    weight: 30,
    patterns: [
      /\bno time (?:to|for) (?:write|writing|blog|content|market)/i,
      /\bdon'?t have (?:the )?time (?:to|for) (?:write|writing|blog|content|seo|market)/i,
      /\b(?:hate|dread|can'?t stand|loathe) (?:writing|blogging|writing blog)/i,
      /\bwriting (?:blog posts?|content|articles) (?:is|takes|feels) [^.!?]{0,40}\b(?:forever|draining|a chore|exhausting|soul)/i,
      /\bkeep (?:putting off|postponing|pushing back) (?:the )?(?:blog|content|seo|writing)/i,
      /\bsolo (?:founder|dev)[^.!?]{0,60}\b(?:content|blog|seo|marketing)/i,
      /\bwearing (?:all|every) (?:the )?hats?\b/i,
    ],
  },
  {
    kind: 'quit_content',
    label: 'Started a blog, stopped',
    weight: 29,
    patterns: [
      /\b(?:wrote|published|posted) (?:only |just |about )?\b(?:one|two|three|four|five|1|2|3|4|5|6|\d{1,2})\b (?:blog )?(?:posts?|articles?)[^.!?]{0,40}\b(?:then|and) (?:stopped|gave up|quit|nothing|never)/i,
      /\b(?:gave up|stopped|abandoned|let it die|fell off) (?:on |with )?(?:the |my |our )?(?:blog|content|newsletter|seo)/i,
      /\bmy blog (?:has|is) (?:been )?(?:dead|stale|untouched|empty|dormant)/i,
      /\b(?:last|hasn'?t) (?:post|published|updated)[^.!?]{0,30}\b(?:months?|year)s? ago\b/i,
      /\bstarted (?:a |the )?blog[^.!?]{0,50}\b(?:then|but) (?:stopped|life|got busy|nothing)/i,
      /\bconsistency\b[^.!?]{0,40}\b(?:problem|struggle|hard|issue)/i,
    ],
  },
  {
    kind: 'distribution',
    label: 'Building over distributing',
    weight: 27,
    patterns: [
      /\b(?:avoid|neglect|ignore|procrastinate on|hide from)(?:ing)? (?:the )?(?:distribution|marketing|promotion)/i,
      /\bbuild(?:ing)? (?:is|feels) (?:easier|safer|more fun|comfortable)[^.!?]{0,50}\b(?:than |market|distribut|sell)/i,
      /\bdistribution (?:is|>|beats|matters more than) [^.!?]{0,30}\b(?:product|building|code|everything)/i,
      /\bkeep (?:building|shipping|coding)[^.!?]{0,50}\b(?:instead of|rather than) (?:market|sell|distribut|promot)/i,
      /\bif (?:we|i) (?:put|spent) the same (?:energy|effort|time)[^.!?]{0,40}\b(?:distribut|market|sell)/i,
      /\bbuild it and they (?:will )?come\b/i,
    ],
  },
  {
    kind: 'seo_slow',
    label: 'Doing SEO, discouraged by the lag',
    weight: 24,
    patterns: [
      /\bseo (?:is|feels|takes) (?:so |too |painfully )?(?:slow|long|forever)/i,
      /\b(?:months?|weeks?) (?:of|into) (?:seo|blogging|content)[^.!?]{0,40}\b(?:nothing|no results?|flat|zero)/i,
      /\b(?:is|does) (?:seo|content marketing) (?:even |still )?worth it\b/i,
      /\bhow long (?:does|until|before) (?:seo|content|blogging|organic)/i,
      /\b(?:not|no) (?:ranking|indexed|showing up) (?:for )?(?:anything|any keywords?)?\b/i,
      /\borganic (?:traffic|search) (?:is )?(?:flat|stuck|dead|not moving)/i,
    ],
  },
  {
    kind: 'no_traffic',
    label: 'Shipped it, nobody comes',
    weight: 22,
    patterns: [
      /\bzero (?:traffic|visitors|signups|sign-ups|users|customers)\b/i,
      /\bno (?:traffic|visitors|signups|sign-ups)\b/i,
      /\b(?:can'?t|cannot|struggling to|trying to) (?:get|find|drive) (?:any |more )?(?:traffic|visitors|users|eyeballs|customers)/i,
      /\bhow (?:do|did) (?:you|i|people) (?:get|find) (?:your |their |my )?(?:first )?(?:\d+ )?(?:users|customers|traffic|visitors)/i,
      /\b(?:launched|shipped|built)[^.!?]{0,60}\b(?:crickets|nobody|no one|silence)\b/i,
      /\bcrickets\b/i,
      /\bnobody (?:is )?(?:visiting|finding|signing up|using)/i,
    ],
  },
  {
    kind: 'agency_cost',
    label: 'Priced out of an agency or writer',
    weight: 21,
    patterns: [
      /\b(?:agency|agencies|freelancer?s?|writers?) (?:want|quoted|charge[ds]?|asking)[^.!?]{0,30}[$€£]\s?\d/i,
      /[$€£]\s?\d[\d,.]*\s?(?:k\b)?\/?\s?(?:a |per )?(?:mo\b|month)[^.!?]{0,40}\b(?:seo|content|blog|agency)/i,
      /\b(?:can'?t|cannot) afford (?:an? )?(?:agency|writer|seo|content)/i,
      /\bagency (?:was|is|felt like) (?:a )?(?:waste|scam|ripoff|rip-off|expensive)/i,
      /\bcheaper (?:alternative|option|way)[^.!?]{0,40}\b(?:agency|seo|content writer)/i,
    ],
  },
];

export const PAIN_LABEL: Record<PainKind, string> = PAINS.reduce(
  (acc, p) => ({ ...acc, [p.kind]: p.label }),
  {} as Record<PainKind, string>,
);

/* ─────────────────────────── does Grove even apply ───────────────────────── */

/**
 * Signals the author has a domain of their own to publish to.
 *
 * Grove publishes to the customer's site. Someone selling only through a
 * marketplace has nothing for it to publish to, so pain alone is not a
 * prospect — this is the difference between "has the problem" and "can be
 * helped by this product", and conflating them is how you send a pitch that
 * can't possibly land.
 */
const FIT_SIGNALS: { key: string; label: string; points: number; patterns: RegExp[] }[] = [
  {
    key: 'own_site',
    label: 'Has a site of their own',
    points: 12,
    patterns: [
      /\bmy (?:site|website|blog|landing page|domain)\b/i,
      /\bour (?:site|website|blog|domain)\b/i,
      /\b(?:my|our) (?:saas|startup|product|app|tool|store|shop|agency|business)\b/i,
      /\bi (?:built|launched|run|shipped|made)\b[^.!?]{0,40}\b(?:saas|site|app|product|tool|store|startup)/i,
      /\b(?:webflow|framer|shopify|wordpress|next\.?js|squarespace)\b/i,
      /\b[a-z0-9-]{3,}\.(?:com|io|ai|co|app|dev|net|xyz)\b/i,
    ],
  },
  {
    key: 'solo',
    label: 'Solo / bootstrapped — no marketing hire coming',
    points: 7,
    patterns: [
      /\b(?:solo|indie) (?:founder|hacker|dev|developer|maker)\b/i,
      /\bbootstrapp?(?:ed|ing)\b/i,
      /\bone[- ]person (?:team|company|shop)\b/i,
      /\bno (?:marketing )?(?:team|budget|marketer)\b/i,
      /\bjust me\b/i,
    ],
  },
  {
    key: 'intent',
    label: 'Already shopping for a fix',
    points: 8,
    patterns: [
      /\b(?:any|what) (?:tools?|recommendations?|suggestions?)[^.!?]{0,40}\b(?:seo|content|blog|writing)/i,
      /\blooking for (?:a |an )?(?:tool|way|solution|service)[^.!?]{0,40}\b(?:seo|content|blog|traffic)/i,
      /\b(?:should i|worth) (?:hire|hiring|outsourc|pay)/i,
      /\bhow (?:do|should) i (?:start|approach|do) (?:seo|content|blogging)/i,
    ],
  },
];

/* ───────────────────────────── reasons not to ────────────────────────────── */

export type BlockerKind =
  | 'no_dm'
  | 'competitor'
  | 'for_hire'
  | 'anti_ai'
  | 'deleted'
  | 'stale'
  | 'thin'
  | 'crowded';

type BlockerDef = {
  kind: BlockerKind;
  label: string;
  /** Hard blockers force tier 'skip' regardless of score. */
  hard: boolean;
  /** Points removed when soft. Ignored when hard. */
  penalty: number;
  patterns: RegExp[];
};

/**
 * The text-matched blockers. Post-shape blockers (age, thinness, thread size,
 * deleted authors) are computed in `screenPost` where the numbers live.
 *
 * `anti_ai` is hard and matches only unambiguous statements. Someone *asking*
 * whether Google penalises AI content is a prospect with a real objection;
 * someone who wrote "I'd never publish AI slop" has told you the answer, and
 * pitching them anyway is how a product gets a reputation before it has users.
 */
const TEXT_BLOCKERS: BlockerDef[] = [
  {
    kind: 'no_dm',
    label: 'Asked not to be pitched',
    hard: true,
    penalty: 0,
    patterns: [
      /\b(?:no|don'?t|do not|please no|stop) (?:send(?:ing)? )?(?:me )?(?:dms?|pms?|dm me|pm me|direct messages?)\b/i,
      /\bnot looking for (?:tools?|a tool|services?|vendors?|pitches?|solutions?)\b/i,
      /\bno (?:pitches?|solicitation|self[- ]promo|vendors?|sales)\b/i,
      /\bdon'?t (?:pitch|sell to) me\b/i,
    ],
  },
  {
    kind: 'competitor',
    label: 'Building the same thing',
    hard: true,
    penalty: 0,
    patterns: [
      /\b(?:i|we) (?:built|made|launched|am building|are building|'m building)\b[^.!?]{0,60}\b(?:ai (?:writer|seo|content|blog)|seo tool|content tool|autoblog|blog automation|programmatic seo)/i,
      /\bmy (?:tool|app|saas|product|startup)\b[^.!?]{0,50}\b(?:writes?|generates?|publishes?)\b[^.!?]{0,30}\b(?:blog|content|articles?|seo)/i,
      /\b(?:ai|automated) (?:seo|content|blog|writing) (?:tool|platform|saas|startup) (?:i|we) (?:built|made|run)/i,
    ],
  },
  {
    kind: 'for_hire',
    label: 'Selling SEO themselves',
    hard: true,
    penalty: 0,
    patterns: [
      /\b(?:for hire|hire me|available for (?:work|hire|projects?))\b/i,
      /\bi (?:do|offer|provide|run) (?:seo|content marketing|link building)\b[^.!?]{0,40}\b(?:for clients?|services?|agency)/i,
      /\b(?:dm|pm|message) me (?:if|for)\b[^.!?]{0,40}\b(?:seo|content|audit|services?|rates?)/i,
      /\b(?:my|our) (?:seo|content|marketing) agency\b[^.!?]{0,40}\b(?:clients?|helps?|works? with)/i,
      /\b(?:hiring|we'?re hiring|looking to hire)\b/i,
    ],
  },
  {
    kind: 'anti_ai',
    label: 'Explicitly against AI-written content',
    hard: true,
    penalty: 0,
    patterns: [
      /\b(?:ai|gpt|chatgpt)[- ]?(?:generated |written )?slop\b/i,
      /\b(?:never|won'?t|refuse to|would not|wouldn'?t) (?:use |publish |post )?ai (?:to )?(?:write|generate|content)/i,
      /\bai content is (?:garbage|trash|worthless|killing|ruining|spam)\b/i,
      /\bi hate ai[- ](?:written|generated) (?:content|articles?|posts?)\b/i,
      /\bhuman[- ]written only\b/i,
    ],
  },
];

export type Blocker = { kind: BlockerKind; label: string; hard: boolean; quote: string | null };

export type Evidence = {
  /** Which pain or fit signal fired. */
  key: string;
  label: string;
  /** The author's own sentence, trimmed. This is what the DM references. */
  quote: string;
};

export type Tier = 'strong' | 'worth_a_look' | 'skip';

export type Screen = {
  /** 0–100. Comparable only within a batch; the tier is the decision. */
  fit: number;
  tier: Tier;
  /** The angle the DM should lead with. Null when no pain matched. */
  pain: PainKind | null;
  /** Every pain that fired, strongest first. */
  pains: PainKind[];
  /** Quotes backing the score — the pain first, then fit signals. */
  evidence: Evidence[];
  blockers: Blocker[];
  /** Plain-English arithmetic, so a surprising score can be argued with. */
  reasons: string[];
};

/* ───────────────────────────────── scoring ───────────────────────────────── */

const STRONG_AT = 62;
const LOOK_AT = 40;

/** Post age past which a DM referencing it reads as surveillance, not attention. */
const STALE_DAYS = 21;
/** Comment count past which a DM is one of many and the author is saturated. */
const CROWDED_COMMENTS = 300;

/**
 * Score one post.
 *
 * `now` is injectable so the recency arithmetic is pinnable in tests — a screen
 * whose verdict depends on the wall clock can't be regression-tested at all.
 */
export function screenPost(post: RedditPost, now: Date = new Date()): Screen {
  // BODY FIRST, title last. Both are the author's words and both should match,
  // but `firstQuote` returns the earliest hit and that quote becomes the DM's
  // opening line — and a title read back at someone says "I saw your headline",
  // while a sentence from the body says "I read this". Titles still match when
  // the body doesn't carry the phrase, or when there is no body at all.
  const haystack = `${post.selftext ?? ''}\n\n${post.title}`;
  const reasons: string[] = [];
  const evidence: Evidence[] = [];
  const blockers: Blocker[] = [];

  /* pains — strongest single match sets the angle, extras add a little */
  const hits = PAINS.map((p) => ({ def: p, quote: firstQuote(haystack, p.patterns) }))
    .filter((h) => h.quote !== null)
    .sort((a, b) => b.def.weight - a.def.weight);

  let score = 0;
  if (hits.length) {
    const top = hits[0];
    score += top.def.weight;
    reasons.push(`+${top.def.weight} ${top.def.label.toLowerCase()}`);
    for (const h of hits) evidence.push({ key: h.def.kind, label: h.def.label, quote: h.quote! });
    // Extra pains corroborate but don't stack linearly — three ways of saying
    // "I'm not publishing" is one problem, not three.
    const extra = Math.min(16, (hits.length - 1) * 8);
    if (extra) {
      score += extra;
      reasons.push(`+${extra} says it ${hits.length} different ways`);
    }
  } else {
    reasons.push('+0 no pain Grove addresses');
  }

  /* fit — can this product reach them at all */
  for (const sig of FIT_SIGNALS) {
    const quote = firstQuote(haystack, sig.patterns);
    if (!quote) continue;
    score += sig.points;
    reasons.push(`+${sig.points} ${sig.label.toLowerCase()}`);
    evidence.push({ key: sig.key, label: sig.label, quote });
  }

  /* text blockers */
  for (const b of TEXT_BLOCKERS) {
    const quote = firstQuote(haystack, b.patterns);
    if (!quote) continue;
    blockers.push({ kind: b.kind, label: b.label, hard: b.hard, quote });
    if (!b.hard) score -= b.penalty;
    reasons.push(b.hard ? `BLOCK ${b.label.toLowerCase()}` : `-${b.penalty} ${b.label.toLowerCase()}`);
  }

  /* shape: recency */
  const ageDays = Math.max(0, (now.getTime() / 1000 - post.createdUtc) / 86_400);
  if (ageDays <= 3) {
    score += 12;
    reasons.push('+12 posted in the last 3 days');
  } else if (ageDays <= 7) {
    score += 6;
    reasons.push('+6 posted this week');
  } else if (ageDays > STALE_DAYS) {
    blockers.push({
      kind: 'stale',
      label: `Posted ${Math.round(ageDays)} days ago — they've moved on`,
      hard: false,
      quote: null,
    });
    score -= 14;
    reasons.push('-14 too old to reference naturally');
  }

  /* shape: is there enough of them here to write a real first line */
  const bodyLen = (post.selftext ?? '').trim().length;
  if (bodyLen >= 240) {
    score += 8;
    reasons.push('+8 wrote at length — plenty to reference');
  } else if (bodyLen >= 80) {
    score += 4;
    reasons.push('+4 some body text to reference');
  } else {
    blockers.push({
      kind: 'thin',
      label: 'Almost no body text — nothing specific to open with',
      hard: false,
      quote: null,
    });
    score -= 6;
    reasons.push('-6 nothing specific to open with');
  }

  /* shape: are they already drowning in replies */
  if (post.numComments > CROWDED_COMMENTS) {
    blockers.push({
      kind: 'crowded',
      label: `${post.numComments} comments — your DM is one of many today`,
      hard: false,
      quote: null,
    });
    score -= 8;
    reasons.push('-8 thread is saturated');
  } else if (post.numComments >= 1) {
    score += 4;
    reasons.push('+4 actively in the conversation');
  }

  /* shape: is there anyone to write to */
  if (!post.author || /^\[?deleted\]?$/i.test(post.author) || post.author.toLowerCase() === 'automoderator') {
    blockers.push({ kind: 'deleted', label: 'No reachable author', hard: true, quote: null });
    reasons.push('BLOCK no reachable author');
  }

  const fit = clamp(Math.round(score));
  const hardBlocked = blockers.some((b) => b.hard);
  const tier: Tier = hardBlocked ? 'skip' : fit >= STRONG_AT ? 'strong' : fit >= LOOK_AT ? 'worth_a_look' : 'skip';

  return {
    fit,
    tier,
    pain: hits[0]?.def.kind ?? null,
    pains: hits.map((h) => h.def.kind),
    evidence,
    blockers,
    reasons,
  };
}

export type Prospect = { post: RedditPost; screen: Screen };

/**
 * Screen a batch and return only what's worth a human's attention, best first.
 *
 * `excludeAuthors` is not an optimisation — it is the thing that stops the
 * machine DMing the same person every time they post. Pass every author already
 * in the outreach table (see store.ts); a second pitch to someone who ignored
 * the first is the definition of spam.
 */
export function rankProspects(
  posts: RedditPost[],
  opts: { now?: Date; excludeAuthors?: Iterable<string>; minTier?: Tier } = {},
): Prospect[] {
  const now = opts.now ?? new Date();
  const seen = new Set<string>();
  const excluded = new Set(Array.from(opts.excludeAuthors ?? []).map((a) => a.toLowerCase()));
  const floor = opts.minTier ?? 'worth_a_look';

  const out: Prospect[] = [];
  for (const post of posts) {
    // The same post surfaces under several queries; the first sighting wins.
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    if (excluded.has((post.author ?? '').toLowerCase())) continue;
    const screen = screenPost(post, now);
    if (!tierAtLeast(screen.tier, floor)) continue;
    out.push({ post, screen });
  }
  return out.sort((a, b) => b.screen.fit - a.screen.fit);
}

const TIER_ORDER: Record<Tier, number> = { skip: 0, worth_a_look: 1, strong: 2 };
export function tierAtLeast(tier: Tier, floor: Tier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[floor];
}

export const TIER_LABEL: Record<Tier, string> = {
  strong: 'Strong fit',
  worth_a_look: 'Worth a look',
  skip: 'Skip',
};

/* ──────────────────────────────── helpers ────────────────────────────────── */

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/**
 * The author's own sentence containing the first pattern match.
 *
 * A bare regex match ("crickets") is useless to a human reviewing the call and
 * useless to the DM writer. The surrounding sentence is what makes the verdict
 * checkable, so evidence is always a quote and never a label alone.
 */
function firstQuote(text: string, patterns: RegExp[]): string | null {
  // EARLIEST MATCH ACROSS ALL PATTERNS, not the first pattern that happens to
  // match. Returning on the first hit would make the order of the pattern list
  // — an implementation detail nobody curates — decide which of the author's
  // sentences gets quoted in the DM, and would defeat the body-before-title
  // ordering of the haystack entirely.
  let best: number | null = null;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && typeof m.index === 'number' && (best === null || m.index < best)) best = m.index;
  }
  return best === null ? null : sentenceAround(text, best);
}

/** Widen an index out to sentence boundaries, then trim to something quotable. */
export function sentenceAround(text: string, index: number, maxLen = 220): string {
  const before = text.slice(0, index);
  const start = Math.max(
    before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n'),
  );
  const rest = text.slice(index);
  const endRel = rest.search(/[.!?\n]/);
  const end = endRel === -1 ? text.length : index + endRel + 1;

  let quote = text.slice(start + 1, end).replace(/\s+/g, ' ').trim();
  if (quote.length > maxLen) quote = `${quote.slice(0, maxLen - 1).trimEnd()}…`;
  return quote;
}
