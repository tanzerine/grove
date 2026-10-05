/**
 * PostHog MCP analytics for grove's hand-rolled MCP server.
 *
 * The route has no `McpServer` for `@posthog/mcp`'s `instrument()` to wrap, so
 * this uses the SDK's custom-dispatcher client and records one `$mcp_tool_call`
 * per `tools/call`.
 *
 * Deliberately NOT done: `prepareToolList()` / `prepareToolCall()` /
 * `prepareToolResult()`. Those inject `context`, `llm_model` and
 * `conversation_id` into every tool's schema and the results — i.e. they change
 * what every connected agent sees. That is a product decision, not a side
 * effect of turning analytics on, so model capture and conversation ids are off
 * and the wire format is exactly what it was.
 *
 * Same two guarantees as lib/analytics/capture-server.ts: it never throws (a
 * metrics blip must not fail a customer's sync) and it no-ops without a token.
 * Arguments and responses are not captured — a `pull_new` response is whole
 * articles, and `create_draft`'s arguments are one.
 */
import { after } from 'next/server';
import { PostHogMCP } from '@posthog/mcp';
import { SERVER_INFO } from './protocol';

let client: PostHogMCP | null = null;

function posthog(): PostHogMCP | null {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) return null;
  if (!client) {
    client = new PostHogMCP(token, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      captureModel: false,
      enableConversationId: false,
      // Which deploy served the call; Vercel sets this on every build.
      ...(process.env.VERCEL_GIT_COMMIT_SHA ? { serverBuild: process.env.VERCEL_GIT_COMMIT_SHA } : {}),
    });
  }
  return client;
}

export type McpToolCallEvent = {
  /** Supabase user id — the same distinct id as every other server event. */
  userId: string;
  toolName: string;
  durationMs: number;
  isError: boolean;
  error?: unknown;
  protocolVersion?: string;
  userAgent?: string | null;
  vendorClient?: string | null;
};

export function captureMcpToolCall(e: McpToolCallEvent): void {
  try {
    const ph = posthog();
    if (!ph) return;
    ph.captureToolCall({
      distinctId: e.userId,
      toolName: e.toolName,
      durationMs: e.durationMs,
      isError: e.isError,
      ...(e.error === undefined ? {} : { error: e.error }),
      ...(e.protocolVersion ? { protocolVersion: e.protocolVersion } : {}),
      ...(e.userAgent ? { clientUserAgent: e.userAgent } : {}),
      ...(e.vendorClient ? { vendorClient: e.vendorClient } : {}),
      properties: { $mcp_server_name: SERVER_INFO.name, $mcp_server_version: SERVER_INFO.version },
    });
  } catch {
    // Observational only — see the header.
  }
}

/**
 * Send whatever is queued once the response has gone out. `after()` is
 * Next's `waitUntil`: the client isn't kept waiting on PostHog, and the
 * function isn't frozen with the event still in the queue.
 */
export function flushMcpAnalyticsAfterResponse(): void {
  const ph = client;
  if (!ph) return;
  const flush = () => ph.flush().catch(() => {});
  try {
    after(flush);
  } catch {
    // Outside a request scope (a test calling POST directly): send now.
    void flush();
  }
}
