/**
 * Push a published post's social copy to each connected platform.
 *
 * Defensive by design: one platform failing never throws to the caller (the
 * blog publish must not be held hostage to a flaky social API). Results are
 * recorded in posts.social_published so the cron never double-posts.
 */
import { supabaseAdmin } from '../supabase/admin';
import { getConnections, type Connection } from './oauth';

type SocialCopy = { x?: string; linkedin?: string; instagram?: string } | null;

export type PostForShare = {
  id: string;
  title: string | null;
  slug: string | null;
  social: SocialCopy;
  cover_image_url?: string | null;
  social_published?: Record<string, { id?: string; at: string; error?: string }> | null;
};

export type DomainForShare = { blog_slug: string };

export function blogUrlFor(domain: DomainForShare, slug: string | null): string {
  const root = (process.env.GROVE_BLOG_ROOT_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const path = slug ?? '';
  return root
    ? `https://${domain.blog_slug}.${root}/${path}`
    : `https://grove.so/b/${domain.blog_slug}/${path}`;
}

/* ───────────── copy composition ───────────── */
function firstTweet(thread?: string): string {
  if (!thread) return '';
  const line = thread.split('\n').map((l) => l.trim()).find((l) => l && /[a-z]/i.test(l)) ?? '';
  return line.replace(/^\d+[).\/]\s*/, '').trim();
}
function clamp(s: string, n: number) { return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…'; }

function xText(p: PostForShare, url: string): string {
  const base = firstTweet(p.social?.x) || p.title || '';
  return `${clamp(base, 278 - url.length - 2)}\n\n${url}`;
}
function liText(p: PostForShare, url: string): string {
  const base = p.social?.linkedin || p.title || '';
  return `${base}\n\n${url}`;
}
function igCaption(p: PostForShare, url: string): string {
  const base = p.social?.instagram || p.title || '';
  return clamp(`${base}\n\nRead more — link in bio.\n${url}`, 2100);
}

/* ───────────── per-platform posting ───────────── */
async function postX(conn: Connection, text: string): Promise<string> {
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { authorization: `Bearer ${conn.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw new Error(`X post failed: ${await r.text()}`);
  const j = await r.json();
  return j?.data?.id ?? '';
}

async function postLinkedIn(conn: Connection, text: string, url: string): Promise<string> {
  if (!conn.account_id) throw new Error('LinkedIn author URN missing — reconnect');
  const body = {
    author: conn.account_id,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: url }],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${conn.access_token}`,
      'content-type': 'application/json',
      'x-restli-protocol-version': '2.0.0',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`LinkedIn post failed: ${await r.text()}`);
  return r.headers.get('x-restli-id') ?? (await r.json())?.id ?? '';
}

async function postInstagram(conn: Connection, caption: string, imageUrl?: string | null): Promise<string> {
  if (!conn.account_id) throw new Error('Instagram business account id missing — reconnect');
  if (!imageUrl) throw new Error('Instagram requires an image — post has no cover image');
  // 1) create media container
  const createUrl = new URL(`https://graph.facebook.com/v19.0/${conn.account_id}/media`);
  createUrl.searchParams.set('image_url', imageUrl);
  createUrl.searchParams.set('caption', caption);
  createUrl.searchParams.set('access_token', conn.access_token);
  const c = await fetch(createUrl, { method: 'POST' });
  if (!c.ok) throw new Error(`IG container failed: ${await c.text()}`);
  const creationId = (await c.json())?.id;
  if (!creationId) throw new Error('IG container returned no id');
  // 2) publish container
  const pubUrl = new URL(`https://graph.facebook.com/v19.0/${conn.account_id}/media_publish`);
  pubUrl.searchParams.set('creation_id', creationId);
  pubUrl.searchParams.set('access_token', conn.access_token);
  const pub = await fetch(pubUrl, { method: 'POST' });
  if (!pub.ok) throw new Error(`IG publish failed: ${await pub.text()}`);
  return (await pub.json())?.id ?? '';
}

/* ───────────── orchestrator ───────────── */
export async function publishToSocials(
  domainId: string, post: PostForShare, domain: DomainForShare,
): Promise<Record<string, { id?: string; at: string; error?: string }>> {
  const conns = await getConnections(domainId);
  if (!conns.length) return post.social_published ?? {};

  const url = blogUrlFor(domain, post.slug);
  const already = post.social_published ?? {};
  const result = { ...already };

  for (const conn of conns) {
    if (already[conn.platform]?.id) continue; // already posted successfully
    try {
      let id = '';
      if (conn.platform === 'x') id = await postX(conn, xText(post, url));
      else if (conn.platform === 'linkedin') id = await postLinkedIn(conn, liText(post, url), url);
      else if (conn.platform === 'instagram') id = await postInstagram(conn, igCaption(post, url), post.cover_image_url);
      result[conn.platform] = { id, at: new Date().toISOString() };
    } catch (e: any) {
      result[conn.platform] = { at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 300) };
    }
  }

  await supabaseAdmin().from('posts').update({ social_published: result }).eq('id', post.id);
  return result;
}
