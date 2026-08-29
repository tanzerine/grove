/**
 * The optional LLM pass over a draft. SERVER ONLY (imports the Replicate client).
 *
 * It rewrites the OPENER and nothing else. That boundary is the whole design:
 *
 *  - The bridge, the product line, the honest caveat and the offer are the
 *    parts that must be identical in every DM, because they are the claims. A
 *    model that rephrases "it won't get you a customer this month" into
 *    something warmer has quietly turned the most honest sentence in the
 *    message into a sales line, and nobody would notice until a beta tester
 *    quoted it back.
 *  - The opener is the only part that should differ per person, and it is the
 *    only part a model can improve on a regex — reading what they actually said
 *    and answering it in one sentence.
 *
 * Every failure degrades to the deterministic draft: no token, no network, a
 * refusal, an over-long answer, a hallucinated URL. The caller always has a
 * sendable message.
 */
import { llmCall } from '../llm';
import { composeDm, wordCount, lengthWarnings, isLengthWarning, type DmDraft, type DmOptions } from './dm';
import type { Prospect } from './screen';

/** Past this the opener stops being an opener. */
const MAX_OPENER_WORDS = 45;

const SYSTEM = `You write the first line of a cold Reddit DM from one founder to another.

You are given a Reddit post. Write ONE short paragraph (1-2 sentences, under 40 words) that shows you actually read it, and hands off to a paragraph about SEO being repetitive and slow.

Rules:
- Reference something specific and particular to THIS post. If you could send your sentence to a hundred other people, it is wrong.
- Quote at most a short fragment of their words, in double quotes.
- No compliments about them as a person ("you clearly think hard about this"). React to the idea, not the author.
- No product name, no pitch, no link, no offer, no greeting line, no sign-off.
- Plain sentences. No em-dash-heavy copywriter voice, no "I couldn't agree more", no exclamation marks.
- Never invent facts about them, their company, their revenue or their traffic.

Reply with the paragraph only. No preamble, no quotes around the whole thing.`;

/**
 * Draft with an LLM-written opener, falling back to the deterministic one.
 *
 * `fast: true` — this is a cheap per-prospect call on the workhorse, run maybe
 * twenty times per scan. It is not a place for the strategy tier.
 */
export async function personalizedDm(
  prospect: Prospect,
  opts: DmOptions & { timeoutMs?: number },
): Promise<DmDraft & { personalized: boolean }> {
  const base = composeDm(prospect, opts);
  if (!process.env.REPLICATE_API_TOKEN) return { ...base, personalized: false };

  try {
    const { text } = await llmCall({
      system: SYSTEM,
      user: promptFor(prospect),
      fast: true,
      maxTokens: 200,
      timeoutMs: opts.timeoutMs ?? 25_000,
    });
    const opener = cleanOpener(text);
    if (!opener) return { ...base, personalized: false };
    return { ...swapOpener(base, opener), personalized: true };
  } catch {
    // Silent: a scan of twenty prospects should not fail because one model call
    // did, and the deterministic draft is genuinely sendable.
    return { ...base, personalized: false };
  }
}

function promptFor({ post, screen }: Prospect): string {
  const quotes = screen.evidence.map((e) => `- ${e.quote}`).join('\n');
  return [
    `Subreddit: r/${post.subreddit}`,
    `Title: ${post.title}`,
    `Body:\n${(post.selftext || '(no body text)').slice(0, 2500)}`,
    quotes ? `\nLines that made this person a prospect:\n${quotes}` : '',
    '\nThe paragraph after yours argues that SEO is repetitive to do and invisible for months. Hand off to that.',
  ].join('\n');
}

/**
 * Strip the ways a model wraps an answer, and reject anything that isn't an
 * opener. Rejection is cheap — the deterministic line is already good.
 */
export function cleanOpener(raw: string): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;

  // Fenced or labelled output.
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  s = s.replace(/^(?:opener|paragraph|first line|here(?:'s| is)[^:]{0,30})\s*:\s*/i, '').trim();
  // A model quoting its whole answer.
  if (/^"[^"]*"$/.test(s)) s = s.slice(1, -1).trim();

  // Only the first paragraph — anything after it is the model writing the rest
  // of the DM, which is exactly what this pass must not do.
  s = s.split(/\n\s*\n/)[0].trim();

  if (!s) return null;
  if (wordCount(s) > MAX_OPENER_WORDS) return null;
  // Guardrails against it drifting into the pitch we removed from its job.
  if (/\bgrove\b/i.test(s)) return null;
  if (/https?:\/\/|\bwww\./i.test(s)) return null;
  if (/\b(?:free beta|no card|coupon|code [A-Z0-9]{5,})\b/i.test(s)) return null;
  return s;
}

/** Replace paragraph one, leave every claim below it untouched. */
function swapOpener(draft: DmDraft, opener: string): DmDraft {
  const rest = draft.body.split('\n\n').slice(1);
  const body = [opener, ...rest].join('\n\n');
  const words = wordCount(body);
  // Drop the length warnings measured against the old opener and re-measure —
  // the send warnings (blockers, subreddit rules) are about the person, not the
  // prose, and must survive untouched.
  const warnings = [...draft.warnings.filter((w) => !isLengthWarning(w)), ...lengthWarnings(words)];
  return { ...draft, body, words, warnings };
}
