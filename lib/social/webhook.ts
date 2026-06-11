/**
 * Outbound "share on publish" webhook — the no-OAuth path to auto-share.
 *
 * On publish, Grove POSTs a JSON payload describing the post (canonical URL,
 * cover image, and ready-to-post per-platform copy) to a URL the owner
 * configures. They wire that into Zapier / Make / n8n and fan out to any
 * network — no platform app-review required.
 *
 * The body is signed with HMAC-SHA256 (header `x-grove-signature: sha256=<hex>`)
 * so the receiver can verify authenticity. Pure payload/signature helpers are
 * separated from the network call so they're unit-testable.
 */
import { createHmac } from 'crypto';
import {
  composeShare, blogUrlFor, isDryRun,
  type PostForShare, type DomainForShare,
} from './compose';
import { PLATFORMS } from './providers';

export type WebhookResult = { at: string; status?: number; error?: string; dry_run?: boolean };

const SIGNATURE_HEADER = 'x-grove-signature';
const TIMEOUT_MS = 10_000;

export function buildWebhookPayload(post: PostForShare, domain: DomainForShare, url: string) {
  // ready-to-post copy per platform, so the receiver's automation just maps
  // shares.<platform>.text → that network with no extra composition.
  const shares = Object.fromEntries(
    PLATFORMS.map((pf) => [pf, composeShare(pf, post, url)]),
  );
  return {
    event: 'post.published' as const,
    sent_at: new Date().toISOString(),
    post: {
      id: post.id,
      title: post.title,
      slug: post.slug,
      url,
      cover_image_url: post.cover_image_url ?? null,
    },
    domain: { blog_slug: domain.blog_slug },
    social: post.social ?? null,
    shares,
  };
}

export function signPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Deliver the webhook. Never throws — a flaky receiver must not hold the blog
 * publish hostage. Returns null when no URL is configured.
 */
export async function deliverWebhook(
  post: PostForShare,
  domain: DomainForShare,
  cfg: { url?: string | null; secret?: string | null },
): Promise<WebhookResult | null> {
  if (!cfg.url) return null;
  const at = new Date().toISOString();

  const url = blogUrlFor(domain, post.slug);
  const body = JSON.stringify(buildWebhookPayload(post, domain, url));

  if (isDryRun()) {
    console.log('[social webhook dry-run]', cfg.url, body);
    return { at, dry_run: true };
  }

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'grove-webhook/1',
    };
    if (cfg.secret) headers[SIGNATURE_HEADER] = signPayload(body, cfg.secret);

    const r = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) return { at, status: r.status, error: `webhook returned ${r.status}` };
    return { at, status: r.status };
  } catch (e: any) {
    return { at, error: String(e?.message ?? e).slice(0, 300) };
  }
}
