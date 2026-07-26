/**
 * Push a published post's social copy to each connected platform.
 *
 * Defensive: one platform failing never throws to the caller (the blog publish
 * must not be held hostage to a flaky social API). Results are recorded in
 * posts.social_published so the cron never double-posts.
 *
 * Dry-run (SOCIAL_DRY_RUN=true): composes and LOGS the exact request that would
 * be sent, makes no network call, and records { dry_run: true }. Lets owners
 * eyeball real payloads before going live.
 */
import { supabaseAdmin } from '../supabase/admin';
import { getLiveConnections, type Connection } from './oauth';
import {
  composeShare, blogUrlFor, isDryRun,
  type PostForShare, type DomainForShare, type ShareRequest,
} from './compose';
import { deliverWebhook } from './webhook';

export type { PostForShare, DomainForShare } from './compose';
export { blogUrlFor } from './compose';

/* ───────────── per-platform posting ───────────── */
async function postX(conn: Connection, req: ShareRequest): Promise<string> {
  const r = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { authorization: `Bearer ${conn.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: req.text }),
  });
  if (!r.ok) {
    // A 401 after the refresh attempt means the stored refresh token is dead
    // (revoked, or app permissions changed) — the fix is a reconnect, not a retry.
    if (r.status === 401) throw new Error('X authorization expired — reconnect X in Social settings.');
    // 402 = the X developer app is out of write quota/credits. Not an auth or
    // grove problem; the fix is on the X API plan, so say so plainly.
    if (r.status === 402) throw new Error('X posting quota reached — your X API plan is out of write credits. Check your X developer account.');
    if (r.status === 429) throw new Error('X rate limit hit — wait a bit and retry.');
    throw new Error(`X post failed: ${await r.text()}`);
  }
  return (await r.json())?.data?.id ?? '';
}

async function postLinkedIn(conn: Connection, req: ShareRequest): Promise<string> {
  if (!conn.account_id) throw new Error('LinkedIn author URN missing — reconnect');
  const body = {
    author: conn.account_id,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: req.text },
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: req.url }],
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

const POSTERS: Record<string, (c: Connection, r: ShareRequest) => Promise<string>> = {
  x: postX, linkedin: postLinkedIn,
};

export type ShareResult = Record<string, { id?: string; at: string; status?: number; error?: string; dry_run?: boolean }>;

/* ───────────── orchestrator ───────────── */
// Fans a published post out to (1) OAuth-connected platforms and (2) the
// outbound webhook, if either is set. Defensive throughout: one channel
// failing never throws. Idempotent via posts.social_published, so the cron
// can safely re-run without double-posting.
export async function publishToSocials(
  domainId: string, post: PostForShare, domain: DomainForShare,
  opts: { only?: string[] } = {},
): Promise<ShareResult> {
  const all = await getLiveConnections(domainId);
  // Auto fan-out honors the post's per-channel opt-outs; an explicit `only`
  // (the owner pressed "Post now" on that channel) overrides them.
  const disabled = new Set(post.social?.disabled ?? []);
  const conns = opts.only
    ? all.filter((c) => opts.only!.includes(c.platform))
    : all.filter((c) => !disabled.has(c.platform));
  const hasWebhook = !!domain.social_webhook_url && (!opts.only || opts.only.includes('webhook'));
  if (!conns.length && !hasWebhook) return post.social_published ?? {};

  const url = blogUrlFor(domain, post.slug);
  const already: ShareResult = post.social_published ?? {};
  const result: ShareResult = { ...already };
  const dry = isDryRun();

  // 1) OAuth-connected platforms
  for (const conn of conns) {
    if (already[conn.platform]?.id) continue; // already posted successfully
    const req = composeShare(conn.platform, post, url);

    if (dry) {
      console.log('[social dry-run]', JSON.stringify({
        platform: req.platform, url: req.url, text: req.text,
      }));
      result[conn.platform] = { at: new Date().toISOString(), dry_run: true };
      continue;
    }

    try {
      const id = await POSTERS[conn.platform](conn, req);
      result[conn.platform] = { id, at: new Date().toISOString() };
    } catch (e: any) {
      result[conn.platform] = { at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 300) };
    }
  }

  // 2) Outbound webhook — independent of OAuth. Skip if already delivered OK
  //    (a prior error or no record means retry).
  if (hasWebhook && !already.webhook?.status && !already.webhook?.dry_run) {
    const wh = await deliverWebhook(post, domain, {
      url: domain.social_webhook_url, secret: domain.social_webhook_secret,
    });
    if (wh) result.webhook = wh;
  }

  await supabaseAdmin().from('posts').update({ social_published: result }).eq('id', post.id);
  return result;
}
