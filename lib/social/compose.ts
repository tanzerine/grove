/**
 * Pure composition of per-platform social copy. No network, no DB — so it's
 * unit-testable and reused by both the publisher and the dry-run preview.
 */
import type { Platform } from './providers';
import { blogHomeUrl, blogPostUrl, canonicalBaseFor } from '../seo';

// `disabled` lists channels the owner switched off for this post's
// publish-time fan-out (an explicit per-channel "Post now" still works).
export type SocialCopy = { x?: string; linkedin?: string; instagram?: string; disabled?: string[] } | null;

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
  text: string;            // tweet text / LinkedIn commentary / IG caption
  url: string;             // canonical blog URL
  imageUrl?: string | null;
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
  const line = thread.split('\n').map((l) => l.trim()).find((l) => l && /[a-z]/i.test(l)) ?? '';
  return line.replace(/^\d+[).\/]\s*/, '').trim();
}

export function clamp(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

export function composeShare(platform: Platform, post: PostForShare, url: string): ShareRequest {
  if (platform === 'x') {
    const base = firstTweet(post.social?.x) || post.title || '';
    return { platform, url, text: `${clamp(base, 278 - url.length - 2)}\n\n${url}` };
  }
  if (platform === 'linkedin') {
    const base = post.social?.linkedin || post.title || '';
    return { platform, url, text: `${base}\n\n${url}` };
  }
  // instagram
  const base = post.social?.instagram || post.title || '';
  return {
    platform, url,
    text: clamp(`${base}\n\nRead more — link in bio.\n${url}`, 2100),
    imageUrl: post.cover_image_url,
  };
}
