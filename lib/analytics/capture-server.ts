/**
 * Server-side event capture — the only way server code should talk to PostHog.
 *
 * Two guarantees the raw client does not give you:
 *
 * 1. IT NEVER THROWS, AND NEVER REJECTS. Analytics is strictly observational:
 *    nothing it does may change the outcome of the request it is observing.
 *    This is not hypothetical — `getPostHogClient()` is constructed with
 *    `flushAt: 1`, so every capture performs a network round-trip inline, and
 *    the Stripe webhook awaits one on the checkout path. A PostHog outage (or
 *    an unconfigured token returning 401) would otherwise reject inside the
 *    webhook's try block, return 500, and — because the idempotency row is
 *    already written — get swallowed as a duplicate on Stripe's retry. A
 *    metrics blip must not be able to cost someone their subscription.
 *
 * 2. IT NO-OPS WHEN UNCONFIGURED. Without a project token there is nothing to
 *    send to, so we skip the call entirely rather than posting to PostHog with
 *    an empty API key and waiting for the 401. That keeps local dev and any
 *    environment missing the env var fast instead of quietly slow.
 *
 * Callers may `await` this to guarantee delivery before a serverless function
 * freezes (the usual reason to await), or fire-and-forget it. Both are safe.
 */
import { getPostHogClient } from '../posthog-server';
import { sanitizeProps, type EventName, type EventProps } from './events';

/** True when a project token is present. Exported for tests and diagnostics. */
export function analyticsConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN);
}

/**
 * Record one event for a known user.
 *
 * `distinctId` must be the Supabase user id — the same value
 * `PostHogIdentify` passes to `posthog.identify()` on the client, so a
 * person's server-side and browser-side events land on one profile. Passing
 * anything else (an email, a domain id) silently splits their timeline.
 */
export async function captureServer<K extends EventName>(
  distinctId: string,
  event: K,
  properties: EventProps<K>,
): Promise<void> {
  if (!distinctId || !analyticsConfigured()) return;
  try {
    const ph = getPostHogClient();
    ph.capture({
      distinctId,
      event,
      properties: sanitizeProps(properties as Record<string, unknown>),
    });
    await ph.flush();
  } catch {
    // Swallowed by design — see the header. Deliberately not logged either:
    // a PostHog outage would otherwise fill the function logs with noise on
    // every request while changing nothing about the product's behaviour.
  }
}
