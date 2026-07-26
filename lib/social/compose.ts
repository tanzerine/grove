/**
 * Pure composition of per-platform social copy. No network, no DB — so it's
 * unit-testable and reused by both the publisher and the dry-run preview.
 */
import type { Platform } from './providers';
import { blogHomeUrl, blogPostUrl, canonicalBaseFor } from '../seo';

// `disabled` lists channels the owner switched off for this post's
// publish-time fan-out (an explicit per-channel "Post now" still works).
export type SocialCopy = { x?: string; linkedin?: string; disabled?: string[] } | null;

export type PostForShare = {
  id: string;
  title: string | null;
  slug: string | null;
  social: SocialCopy;
  cover_image_url?: string | null;
  social_published?: Record<string, { id?: string; at: string; error?: string; dry_run?: boolean }> | null;
};

export type DomainForShare = {
  blog_slug: string;
  /** Customer-owned blog surfaces — when either is set, social shares spread
   *  the customer's own URL, not the grove mirror. */
  canonical_blog_base?: string | null;
  custom_blog_hostname?: string | null;
  social_webhook_url?: string | null;
  social_webhook_secret?: string | null;
};

export type ShareRequest = {
  platform: Platform;
  text: string;            // tweet text / LinkedIn commentary
  url: string;             // canonical blog URL
};

export function isDryRun(): boolean {
  const v = process.env.SOCIAL_DRY_RUN;
  return v === 'true' || v === '1';
}

// Delegates to lib/seo so social URLs can never diverge from the canonical
// URLs the blog pages, sitemap, and RSS emit.
export function blogUrlFor(domain: DomainForShare, slug: string | null): string {
  const base = canonicalBaseFor(domain);
  return slug
    ? blogPostUrl(domain.blog_slug, slug, base)
    : blogHomeUrl(domain.blog_slug, base);
}

export function firstTweet(thread?: string): string {
  if (!thread) return '';
  // Any letter or digit in any script — /[a-z]/ used to skip Korean-only lines.
  const line = thread.split('\n').map((l) => l.trim()).find((l) => /[\p{L}\p{N}]/u.test(l)) ?? '';
  return line.replace(/^\d+[).\/]\s*/, '').trim();
}

/**
 * Normalize LLM-written X copy into the ONE tweet grove actually posts.
 * The publisher has never threaded — composeShare sends the first line plus
 * the article link — so a model that writes "1/ … 2/ … 🧵" is producing copy
 * the owner reviews but X never sees. Reduce to the first tweet at generation
 * time (numbering/thread-emoji stripped, weighted-clamped to the real
 * first-tweet budget) so the composer previews exactly what will be posted.
 */
export function normalizeXCopy(raw?: string): string {
  const tweet = firstTweet(raw).replace(/\s*🧵\s*$/u, '').trim();
  return clampX(tweet, X_MAX - X_URL_WEIGHT - 2);
}

/* ───────────── X character accounting ─────────────
 * X does NOT count plain string length: every URL costs a flat 23 (t.co),
 * and code points are weighted — the Latin-ish ranges below count 1, all
 * else (CJK, emoji, '…' itself) counts 2. Budgeting with url.length and
 * String.length over-cut some tweets and let others through too long.
 * Ranges follow twitter-text v3's config (complex emoji sequences overcount
 * slightly here, which errs on the safe side). */
export const X_MAX = 280;
export const X_URL_WEIGHT = 23;

function xWeight(cp: number): 1 | 2 {
  return cp <= 0x10ff ||
    (cp >= 0x2000 && cp <= 0x200d) ||
    (cp >= 0x2010 && cp <= 0x201f) ||
    (cp >= 0x2032 && cp <= 0x2037)
    ? 1 : 2;
}

/** Weighted tweet length of plain text (no URLs), the way X counts it. */
export function xLen(s: string): number {
  let n = 0;
  for (const ch of s.normalize('NFC')) n += xWeight(ch.codePointAt(0)!);
  return n;
}

/** Trim to an X weighted budget at a word boundary, appending '…' (weight 2). */
export function clampX(s: string, budget: number): string {
  const text = s.normalize('NFC');
  if (xLen(text) <= budget) return text;
  let used = 0;
  let cut = 0;          // code-unit index where the budget runs out
  let lastSpace = -1;   // code-unit index just past the last whitespace kept
  for (const ch of text) {
    const w = xWeight(ch.codePointAt(0)!);
    if (used + w > budget - 2) break; // reserve 2 for the ellipsis
    used += w;
    cut += ch.length;
    if (/\s/.test(ch)) lastSpace = cut;
  }
  // Prefer the word boundary unless it throws away a suspicious amount
  // (unspaced CJK or one giant token → hard cut is the right fallback).
  const head = lastSpace !== -1 && cut - lastSpace <= 30 ? text.slice(0, lastSpace) : text.slice(0, cut);
  return head.trimEnd() + '…';
}

export function composeShare(platform: Platform, post: PostForShare, url: string): ShareRequest {
  if (platform === 'x') {
    const base = firstTweet(post.social?.x) || post.title || '';
    // The URL costs X_URL_WEIGHT no matter how long it prints; '\n\n' costs 2.
    return { platform, url, text: `${clampX(base, X_MAX - X_URL_WEIGHT - 2)}\n\n${url}` };
  }
  // linkedin
  const base = post.social?.linkedin || post.title || '';
  return { platform, url, text: `${base}\n\n${url}` };
}
