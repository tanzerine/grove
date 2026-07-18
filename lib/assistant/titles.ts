/**
 * CTR title optimizer — the assistant action behind "improve my titles".
 *
 * Google Search Console tells us which articles Google already surfaces but
 * readers don't click (impressions high, CTR low). Those are the cheapest
 * wins on the whole blog: same rankings, better packaging. This module picks
 * the worst offenders and rewrites their titles with ONE workhorse-model
 * call, capped at a handful per action so every change stays reviewable —
 * and undoable (the route returns the old titles as the undo payload).
 *
 * Candidate picking and response validation are pure and unit-tested; the
 * route owns data loading and the DB write.
 */
import { llmCall, extractJson } from '../llm';
import type { ContentRow } from '../search-console/insights';

export const TITLE_LIMITS = {
  minImpressions: 50,   // below this a low CTR is noise, not signal
  maxCtr: 0.02,         // 2% — clearly underperforming for anything Google shows
  maxRewrites: 3,       // one action stays reviewable (and cheap)
} as const;

export type TitleCandidate = {
  postId: string;
  title: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** Articles Google shows but nobody clicks — biggest impression pools first. */
export function pickTitleCandidates(rows: ContentRow[]): TitleCandidate[] {
  return rows
    .filter((r): r is ContentRow & { postId: string } =>
      !!r.postId && !!r.title &&
      r.impressions >= TITLE_LIMITS.minImpressions &&
      r.ctr <= TITLE_LIMITS.maxCtr)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TITLE_LIMITS.maxRewrites)
    .map((r) => ({
      postId: r.postId, title: r.title,
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    }));
}

export type TitleRewrite = { post_id: string; from: string; to: string };

/**
 * Keep only proposals that are safe to apply: a known candidate, a real
 * title (8–90 chars after trimming), actually different from the current
 * one, and at most one rewrite per post. Pure.
 */
export function sanitizeRewrites(
  proposed: Array<{ post_id?: string; title?: string }>,
  candidates: TitleCandidate[],
): TitleRewrite[] {
  const byId = new Map(candidates.map((c) => [c.postId, c]));
  const out: TitleRewrite[] = [];
  for (const p of proposed) {
    const candidate = p.post_id ? byId.get(p.post_id) : undefined;
    const title = (p.title ?? '').trim().replace(/\s+/g, ' ');
    if (!candidate || title.length < 8 || title.length > 90) continue;
    if (title.toLowerCase() === candidate.title.trim().toLowerCase()) continue;
    if (out.some((r) => r.post_id === candidate.postId)) continue;
    out.push({ post_id: candidate.postId, from: candidate.title, to: title });
  }
  return out;
}

export async function rewriteTitles(opts: {
  hostname: string;
  candidates: TitleCandidate[];
}): Promise<TitleRewrite[]> {
  const system = `You are the SEO editor for the ${opts.hostname} blog. Each article below
already ranks — Google shows it, but searchers don't click. Rewrite each
title so a searcher picks it, without breaking what already ranks:

- Keep the article's topic and primary keyword intact and near the front.
- Make the value concrete (outcome, number, freshness) — compelling, never
  clickbait, no ALL CAPS, no emoji.
- 45-65 characters. Keep the original language (Korean stays Korean).
- If a title is genuinely fine, return it unchanged and it will be skipped.

OUTPUT: ONE raw JSON object, no markdown:
{"titles":[{"post_id":"...","title":"the rewritten title"}]}`;

  const user = opts.candidates.map((c) =>
    `post_id: ${c.postId}\ncurrent title: ${c.title}\nimpressions: ${c.impressions}, clicks: ${c.clicks} (CTR ${(c.ctr * 100).toFixed(1)}%), avg position ${c.position.toFixed(1)}`,
  ).join('\n\n');

  const { text } = await llmCall({ system, user, maxTokens: 600 });
  const parsed = extractJson<{ titles?: Array<{ post_id?: string; title?: string }> }>(text);
  return sanitizeRewrites(parsed.titles ?? [], opts.candidates);
}
