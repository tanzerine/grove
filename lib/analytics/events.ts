/**
 * The product-analytics event catalogue — one typed registry for every event
 * Grove sends to PostHog, client or server.
 *
 * WHY A REGISTRY. Events were previously captured with bare string literals at
 * a dozen call sites. Nothing stopped a typo (`post_aproved`), nothing stopped
 * the same concept being sent under two names from two files, and nothing
 * recorded what properties an event is supposed to carry. All three failures
 * are invisible — they don't break a build or a test, they just quietly produce
 * a funnel that can't be trusted months later, which is the one thing analytics
 * exists to prevent.
 *
 * So the name AND the property shape live here, and `captureServer` /
 * `captureClient` accept only what this file declares. A misspelled event or a
 * missing property is a type error at build time (next.config has
 * ignoreBuildErrors: false, so the build is the gate).
 *
 * NAMING. `noun_verb_past_tense`, lowercase snake_case — `post_approved`, not
 * `approvePost`. PostHog groups by prefix in its UI, so the noun comes first
 * and related events sort together.
 *
 * PROPERTIES. Keep them low-cardinality and non-identifying: ids, enums,
 * counts, durations, booleans. Never put article bodies, prompts, emails, or
 * anything a customer wrote into a property — PostHog is not the place for it
 * and it makes the data unusable for aggregation anyway.
 *
 * The names below are deliberately unchanged from what already shipped
 * (post_approved, checkout_started, …) so the events recorded before this
 * registry existed remain part of the same series.
 */

/** Where a post's generation was kicked off from. */
export type GenerationMode = 'queue' | 'wait';

/** How a customer signed in. */
export type AuthMethod = 'google' | 'email';

/** The manager gate's verdict on a finished draft. */
export type ManagerAction = 'approve' | 'rewrite' | 'reject';

/** Ordered steps of first-run onboarding — index in this array IS the step
 *  number, so a funnel in PostHog can be built straight from it. */
export const ONBOARDING_STEPS = ['domain', 'verify', 'about', 'intent'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * Which feature tripped the rate limiter.
 *
 * These are the call-site prefixes from `enforceRateLimit(\`gen:${id}\`, …)`,
 * not the four LIMITS tiers. Deliberately so: LIMITS.crawl is shared by domain
 * profiling, the GSC sync, the interview and repo ingestion, and "a crawl limit
 * was hit" cannot tell you which of those a customer was actually blocked from.
 * The prefix can. Every value here is a literal in the codebase, so the
 * cardinality stays bounded no matter how much traffic arrives.
 */
export const RATE_BUCKETS = [
  'assist', 'betaredeem', 'billing', 'crawl', 'feedback', 'gen', 'gsc', 'img',
  'interview', 'llm', 'mcp', 'planchat', 'refundreq', 'repo', 'strategy', 'upload',
] as const;
export type RateBucket = (typeof RATE_BUCKETS)[number] | 'unknown';

/**
 * Split a limiter key into its feature prefix and the user it belongs to.
 *
 * Pure, so the parsing rule is testable without a limiter or a database. An
 * unrecognised prefix degrades to 'unknown' rather than being dropped — a new
 * call site that forgets to register its prefix should still show up as
 * friction, just unattributed.
 */
export function parseRateBucket(key: string): { bucket: RateBucket; userId: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { bucket: 'unknown', userId: '' };
  const prefix = key.slice(0, idx);
  const userId = key.slice(idx + 1);
  const known = (RATE_BUCKETS as readonly string[]).includes(prefix);
  return { bucket: known ? (prefix as RateBucket) : 'unknown', userId };
}

/** Which ownership check matched, mirroring lib/verify-domain's VerifyMethod. */
export type VerifyVia = 'dns' | 'meta' | 'http';

/**
 * Every event, mapped to the exact properties it carries.
 *
 * `Record<string, never>` means "this event takes no properties" — it reads
 * better at the call site than `{}`, which TypeScript treats as "anything".
 */
export type EventMap = {
  // ── auth ────────────────────────────────────────────────────────────────
  /** A brand-new account was created. `confirmation_required` is the launch
   *  metric that matters: true means the user cannot proceed until they find
   *  a confirmation email, which is where public signups silently die. */
  signed_up: { method: AuthMethod; confirmation_required: boolean };
  signed_in: { method: AuthMethod };
  /** They clicked the confirmation link and got through the email wall. Pairs
   *  with `signed_up{confirmation_required:true}` to give that wall a
   *  completion rate — the number that decides whether email signup is safe to
   *  launch on. No properties: the identity is the whole signal. */
  email_confirmed: Record<string, never>;
  /** Only reasons we can name — never the raw credential or error text. */
  sign_in_failed: { reason: 'wrong_password' | 'other' };

  // ── onboarding ──────────────────────────────────────────────────────────
  onboarding_step_viewed: { step: OnboardingStep; step_number: number };
  domain_submitted: { domain_id: string };
  /** Fired on every attempt, not just successes, so the pass rate is visible.
   *  `via` mirrors lib/verify-domain's VerifyMethod — the three methods race in
   *  parallel and fail for very different reasons (DNS propagation vs. a CDN
   *  serving cached HTML), so which one won is worth knowing. Null on failure,
   *  since nothing matched. */
  domain_verify_attempted: { domain_id: string; ok: boolean; via: VerifyVia | null };
  domain_verified: { domain_id: string; via: VerifyVia | null };
  /** The plan ceiling was hit while connecting another site — the single
   *  clearest upgrade-intent signal in the product. */
  domain_limit_hit: { upgrade_to: string };
  onboarding_completed: { domain_id: string };

  // ── content ─────────────────────────────────────────────────────────────
  post_generation_started: { post_id: string; domain_id: string; mode: GenerationMode };
  /** The success half of the pair above. Subtracting the two gives the real
   *  completion rate, which no existing event could show. */
  post_generation_succeeded: {
    post_id: string;
    domain_id: string;
    duration_ms: number;
    manager_score: number | null;
    manager_action: ManagerAction | null;
  };
  /** `step` is the pipeline stage that threw, so failures are attributable
   *  rather than a single undifferentiated error count. */
  post_generation_failed: { post_id: string; domain_id: string; step: string; duration_ms: number };
  ai_draft_queued: { topic: string; domain_id: string };
  manual_draft_created: { domain_id: string; scheduled: boolean };
  pseo_set_generated: { page_count: number; domain_id: string };
  post_approved: { post_id: string };
  post_published: { post_id: string; scheduled: boolean };
  post_regenerated: { post_id: string; mode: 'fresh' | 'resume' };
  post_deleted: { post_id: string; post_status: string };
  post_section_revised: { post_id: string };
  post_cover_regenerated: { post_id: string };
  illustration_generated: { domain_id: string };
  /** An author put one of their OWN images in a draft. `bytes` is post-strip. */
  image_uploaded: { domain_id: string; format: string; bytes: number };

  // ── distribution & setup ────────────────────────────────────────────────
  embed_snippet_copied: { mode: 'blog' | 'widget' | 'feed'; domain_id: string };
  custom_hostname_set: { domain_id: string };
  blog_settings_saved: { domain_id: string };
  social_account_connected: { platform: string };
  social_account_disconnected: { platform: string };
  post_shared_manually: { post_id: string; platform: string };
  search_console_connected: { domain_id: string };
  search_console_disconnected: { domain_id: string };

  // ── strategy ────────────────────────────────────────────────────────────
  /** `planned_by` records WHICH model built the plan. A plan silently built by
   *  the cheap workhorse instead of the strategy model is a real failure this
   *  product has already had once, and it is invisible in the UI. */
  /** `staged` separates a plan built ahead of the month it covers (the
   *  lookahead that closes the month-boundary outage) from one built for the
   *  month already running — a rising staged share is the rollover working. */
  strategy_built: { domain_id: string; source: 'interview' | 'inferred'; planned_by: string | null; staged?: boolean };
  /** `skipped` matters: a skipped interview yields a materially weaker
   *  strategy, so a high skip rate is a product problem, not a statistic. */
  strategy_interview_completed: { domain_id: string; skipped: boolean };
  /** `revised` separates asking the agent a question from actually changing
   *  the plan — only the latter is the feature being used. */
  strategy_chat_message_sent: { domain_id: string; revised: boolean };

  // ── billing ─────────────────────────────────────────────────────────────
  plan_selected: { plan: string; interval: string };
  checkout_started: { plan: string; interval?: string };
  billing_portal_opened: Record<string, never>;
  subscription_activated: { plan?: string; interval?: string };
  subscription_canceled: { plan?: string };
  refund_requested: { reason: string; plan?: string };

  // ── beta programme ──────────────────────────────────────────────────────
  // The free-beta funnel, measured end to end: how many tried a code, how many
  // got in, and — the only number that decides whether the beta was worth
  // running — how many converted before the grant lapsed.
  /** A code was submitted. `ok` false + `problem` is the whole reason this
   *  fires on failure too: a campaign whose codes are mostly 'expired' or
   *  'exhausted' is losing signups silently, and the customer won't report it. */
  beta_code_submitted: { ok: boolean; problem?: string };
  beta_redeemed: { code: string; posts_quota: number; days: number };
  /** Fired once when a lapsed-beta account is refused generation, which is the
   *  moment the free run converts or churns. */
  beta_expired_blocked: Record<string, never>;

  // ── customer feedback ───────────────────────────────────────────────────
  /** `kind` separates the three doors (testimonial / shortcoming / complaint).
   *  Deliberately carries no free text — the message itself lives in Postgres
   *  where it is access-controlled, not in a third-party analytics store. */
  feedback_submitted: { kind: string; area?: string; severity?: string; rating?: number; consent_publish?: boolean };
  testimonial_published: { feedback_id: string };

  // ── mcp (customer's own content layer) ──────────────────────────────────
  /** An owner minted an API key for the MCP server — intent to integrate. */
  mcp_key_created: Record<string, never>;
  /** A coding agent completed the MCP handshake. Captured on `initialize`
   *  rather than per tool call: one event per client session is the adoption
   *  signal, and `client` says whether that's Claude Code, Cursor or something
   *  else — which is the only place grove can learn what customers build in. */
  mcp_connected: { client?: string; client_version?: string };

  // ── friction ────────────────────────────────────────────────────────────
  // The three walls a customer can hit. These are the highest-value events in
  // the catalogue and the ones the product had no visibility into at all: they
  // mark the exact moment someone wanted to do more and was stopped, which is
  // both the upgrade prompt and the churn warning.
  /** Monthly plan allowance ran out (HTTP 402). */
  quota_exhausted: { limit: number | null; used: number };
  /** Hourly abuse limiter tripped (HTTP 429). */
  rate_limited: { bucket: RateBucket };
  /** No live subscription, so cost-bearing work was refused. `reason` is the
   *  entitlement verdict — 'not_paying' (lapsed) reads very differently from
   *  'no_subscription' (never checked out). */
  generation_blocked_unpaid: { reason: string; feature: string };
};

export type EventName = keyof EventMap;

/** Properties for one event. */
export type EventProps<K extends EventName> = EventMap[K];

/**
 * Every event name, as data.
 *
 * Kept in step with EventMap by `satisfies Record<EventName, true>` — adding an
 * event to the type without adding it here (or vice versa) fails the build.
 * That matters because this list is what documents the catalogue to humans,
 * and a documentation list that drifts is worse than none.
 */
const EVENT_NAME_SET = {
  signed_up: true,
  signed_in: true,
  email_confirmed: true,
  sign_in_failed: true,
  onboarding_step_viewed: true,
  domain_submitted: true,
  domain_verify_attempted: true,
  domain_verified: true,
  domain_limit_hit: true,
  onboarding_completed: true,
  post_generation_started: true,
  post_generation_succeeded: true,
  post_generation_failed: true,
  ai_draft_queued: true,
  manual_draft_created: true,
  pseo_set_generated: true,
  post_approved: true,
  post_published: true,
  post_regenerated: true,
  post_deleted: true,
  post_section_revised: true,
  post_cover_regenerated: true,
  illustration_generated: true,
  image_uploaded: true,
  embed_snippet_copied: true,
  custom_hostname_set: true,
  blog_settings_saved: true,
  social_account_connected: true,
  social_account_disconnected: true,
  post_shared_manually: true,
  search_console_connected: true,
  search_console_disconnected: true,
  strategy_built: true,
  strategy_interview_completed: true,
  strategy_chat_message_sent: true,
  plan_selected: true,
  checkout_started: true,
  billing_portal_opened: true,
  subscription_activated: true,
  subscription_canceled: true,
  refund_requested: true,
  beta_code_submitted: true,
  beta_redeemed: true,
  beta_expired_blocked: true,
  feedback_submitted: true,
  testimonial_published: true,
  mcp_key_created: true,
  mcp_connected: true,
  quota_exhausted: true,
  rate_limited: true,
  generation_blocked_unpaid: true,
} satisfies Record<EventName, true>;

export const EVENT_NAMES = Object.keys(EVENT_NAME_SET).sort() as EventName[];

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENT_NAME_SET, name);
}

/** Step number (1-based) for the onboarding funnel. 0 for an unknown step. */
export function onboardingStepNumber(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

/**
 * Strip properties that must never leave the server.
 *
 * A last line of defence, not the primary one: the primary defence is that
 * EventMap simply doesn't declare such properties. But capture calls get
 * copy-pasted and edited under time pressure, and a leaked email or token in
 * PostHog is not something you can un-send — so anything matching these keys is
 * dropped before the network call regardless of what a call site passed.
 */
const FORBIDDEN_KEY = /email|token|secret|password|api_key|authorization|body_md|prompt/i;

export function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    if (v === undefined) continue; // PostHog stores nulls; undefined is noise
    out[k] = v;
  }
  return out;
}
