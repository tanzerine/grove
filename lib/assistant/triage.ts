/**
 * Deterministic triage for the dashboard assistant — pure, zero-cost, and
 * client-safe (the panel imports SLASH_COMMANDS for its command menu, so
 * nothing in this file may touch the LLM client or any server dep).
 */

export type AssistantIntent = 'write' | 'analytics' | 'strategy' | 'help' | 'general';

export const SLASH_COMMANDS: Array<{ command: string; intent: AssistantIntent; hint: string }> = [
  { command: 'analytics', intent: 'analytics', hint: 'Ask about traffic, clicks, readers' },
  { command: 'write', intent: 'write', hint: 'Queue a new article about…' },
  { command: 'strategy', intent: 'strategy', hint: 'Ask about the monthly plan' },
  { command: 'help', intent: 'help', hint: 'How do I set up…' },
];

/** "/write Queue this week's onboarding post" → { intent: 'write', rest: "Queue…" } */
export function parseSlash(message: string): { intent: AssistantIntent; rest: string } | null {
  const m = message.trim().match(/^\/([a-z]+)\b\s*(.*)$/is);
  if (!m) return null;
  const cmd = SLASH_COMMANDS.find((c) => c.command === m[1].toLowerCase());
  return cmd ? { intent: cmd.intent, rest: m[2].trim() } : null;
}

const WRITE_HINTS = new RegExp(
  [
    '\\bwrite\\b', '\\bdraft\\b', 'article about', 'post about', 'queue an? (article|post)',
    'new article', 'new post', 'blog post about',
    '써\\s*줘', '써줘', '작성해', '글\\s*(을|를)?\\s*써', '기사\\s*작성',
  ].join('|'), 'i',
);

const ANALYTICS_HINTS = new RegExp(
  [
    'views?', 'viewers?', 'readers?', 'reads', 'clicks?', 'impressions?', 'traffic',
    '\\bctr\\b', 'conversions?', 'analytics', 'performance', 'performing', 'ranking',
    'visitors?', 'sessions?', 'organic', 'search console', 'bounce',
    '조회', '트래픽', '방문자', '유입', '전환',
  ].join('|'), 'i',
);

const HELP_HINTS = new RegExp(
  [
    'how (do|can|to|does)', 'how do i', 'set ?up', 'configure', 'connect', 'install',
    'embed', 'canonical', 'cname', 'custom (domain|hostname)', '\\bdns\\b', 'webhook',
    'ga4', 'google analytics', 'what is', 'where (do|can|is)',
    '어떻게', '설정', '연결', '방법',
  ].join('|'), 'i',
);

const STRATEGY_HINTS = new RegExp(
  [
    '\\bplan\\b', 'strategy', 'pillars?', 'calendar', 'schedule', 'topics?',
    'next month', 'this month.*(plan|writing)', 'keywords?',
    '전략', '계획', '주제', '일정',
  ].join('|'), 'i',
);

/**
 * Deterministic (testable, zero-cost) intent triage. Order matters: an
 * explicit ask to write wins, then how-to phrasing — "how to set up the
 * canonical url" must not fall through to the strategy word-net — then
 * performance questions ("how do I get more clicks" is analytics, not help),
 * then plan questions.
 */
export function classifyIntent(message: string): AssistantIntent {
  const slash = parseSlash(message);
  if (slash) return slash.intent;
  const m = message.trim();
  if (WRITE_HINTS.test(m)) return 'write';
  if (HELP_HINTS.test(m) && !ANALYTICS_HINTS.test(m)) return 'help';
  if (ANALYTICS_HINTS.test(m)) return 'analytics';
  if (STRATEGY_HINTS.test(m)) return 'strategy';
  return 'general';
}

/**
 * Pull the article topic out of a write request without an LLM.
 * "I want to write a new article about cold brew ratios" → "cold brew ratios".
 * Returns '' when no usable topic remains (the route then asks for one).
 */
export function writeTopicFrom(message: string): string {
  let t = (parseSlash(message)?.rest ?? message).trim();

  // Leading politeness + verb phrase (EN). The verb itself is optional so a
  // slash remainder like "an article about X" strips too; "on" requires
  // trailing whitespace so it can't bite into a topic like "onboarding".
  t = t.replace(
    /^(please\s+|hey\s+|hi\s+)*((can|could|would|will)\s+you\s+|i\s+(want|would like|'d like|need)\s+(you\s+)?to\s+|let'?s\s+)?(please\s+)?((write|draft|create|queue|make|do)( up)?\s+)?(me\s+)?(a\s+|an\s+|another\s+|this week'?s?\s+|new\s+)*((blog\s+)?(article|post|piece|write-?up)\s*)?((about|on|regarding|covering)\s+|:\s*)?/i,
    '',
  );
  // Korean: "X에 대한 글 써줘" / "X에 대해 작성해줘" → X.
  t = t.replace(/(에\s*대한|에\s*대해)?\s*(글|포스트|기사|아티클)?\s*(을|를)?\s*(하나\s*)?(써\s*줘|써줘|작성해\s*줘|작성해줘|작성해).*$/, '');
  t = t.replace(/[.!?\s]+$/, '').trim();

  // A bare verb with no subject ("write an article") leaves nothing usable.
  if (t.length < 3 || /^(article|post|blog post|something|it)$/i.test(t)) return '';
  return t;
}
