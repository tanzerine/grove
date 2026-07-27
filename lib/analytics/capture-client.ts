/**
 * Browser-side event capture — the client counterpart to capture-server.
 *
 * Same contract: typed against the catalogue in ./events, and it never throws.
 * `posthog-js` is resilient on its own (it queues and retries), but it is not
 * initialised at all when the project token is missing, and calling `capture`
 * on an uninitialised instance is exactly the kind of thing that turns a
 * missing env var into a blank page. Analytics must never be able to break the
 * UI it is measuring, so every call is wrapped.
 *
 * Import this instead of `posthog-js` directly in components — the direct
 * import gives you an untyped `capture(string, any)` with none of the
 * protections above.
 */
'use client';
import posthog from 'posthog-js';
import { sanitizeProps, type EventName, type EventProps } from './events';

export function captureClient<K extends EventName>(
  event: K,
  properties: EventProps<K>,
): void {
  try {
    // `__loaded` is posthog-js's own "init() has run" flag. Without the token
    // instrumentation-client.ts skips init entirely, so this is the honest
    // check for "is there anything to capture into?".
    if (!posthog.__loaded) return;
    posthog.capture(event, sanitizeProps(properties as Record<string, unknown>));
  } catch {
    // Never let a metrics failure surface as a broken interaction.
  }
}
