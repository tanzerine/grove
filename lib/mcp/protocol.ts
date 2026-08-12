/**
 * JSON-RPC 2.0 + MCP framing, as pure functions.
 *
 * Grove speaks the MCP "Streamable HTTP" transport, statelessly: one POST in,
 * one JSON response out, no session id and no SSE stream. The spec allows that
 * (a server MAY reply `application/json` instead of `text/event-stream`, and a
 * server that needs no session simply never issues `Mcp-Session-Id`), and it is
 * the right shape for a serverless route — there is no process to keep a
 * subscription alive in, and nothing grove pushes unprompted.
 *
 * Everything the wire format demands lives here so the route stays a thin
 * auth + dispatch shell and the framing can be tested without HTTP.
 */

/** Newest first — negotiateProtocol() falls back to element 0. */
export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

export const SERVER_INFO = { name: 'grove', title: 'Grove', version: '1.0.0' } as const;

/** Standard JSON-RPC codes. -32000+ is the implementation-defined range. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type RpcId = string | number | null;

export type RpcRequest = {
  jsonrpc: '2.0';
  id?: RpcId;
  method: string;
  params?: Record<string, unknown>;
};

export type RpcResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: unknown }
  | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string; data?: unknown } };

export function rpcResult(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/**
 * A notification is a request with no `id` — the client is not waiting for an
 * answer, and per JSON-RPC we MUST NOT send one. `notifications/initialized`
 * arrives on every connection, so getting this wrong means every client sees a
 * spurious response to a message it never asked about.
 */
export function isNotification(msg: RpcRequest): boolean {
  return msg.id === undefined || msg.id === null;
}

export type ParsedBody =
  | { kind: 'single'; messages: RpcRequest[] }
  | { kind: 'batch'; messages: RpcRequest[] }
  | { kind: 'invalid'; message: string };

/**
 * Validate an already-JSON-parsed body into MCP messages. Batches are accepted
 * (the 2025-03-26 spec required them) and answered with an array of only the
 * responses that have ids.
 */
export function parseBody(body: unknown): ParsedBody {
  if (Array.isArray(body)) {
    if (body.length === 0) return { kind: 'invalid', message: 'empty batch' };
    const messages: RpcRequest[] = [];
    for (const item of body) {
      const one = asRequest(item);
      if (!one) return { kind: 'invalid', message: 'batch contains a non-request' };
      messages.push(one);
    }
    return { kind: 'batch', messages };
  }
  const one = asRequest(body);
  if (!one) return { kind: 'invalid', message: 'not a JSON-RPC 2.0 request' };
  return { kind: 'single', messages: [one] };
}

function asRequest(v: unknown): RpcRequest | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.jsonrpc !== '2.0') return null;
  if (typeof o.method !== 'string' || !o.method) return null;
  const id = o.id;
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') return null;
  const params = o.params && typeof o.params === 'object' && !Array.isArray(o.params)
    ? (o.params as Record<string, unknown>)
    : undefined;
  return { jsonrpc: '2.0', method: o.method, ...(id === undefined ? {} : { id: id as RpcId }), ...(params ? { params } : {}) };
}

/**
 * Echo the client's protocol version when we speak it, else answer with ours
 * and let the client decide whether it can proceed. Never echo an unknown
 * version back: that claims support grove does not have.
 */
export function negotiateProtocol(requested: unknown): string {
  const v = typeof requested === 'string' ? requested : '';
  return (PROTOCOL_VERSIONS as readonly string[]).includes(v) ? v : LATEST_PROTOCOL;
}

/**
 * `instructions` is the highest-leverage field in the whole handshake: clients
 * put it in the model's system prompt, so it is grove's one chance to tell the
 * customer's agent how this content is meant to be used before it starts
 * inventing an integration. Keep it short, imperative, and about THIS product.
 */
export const INSTRUCTIONS = [
  'Grove writes and quality-gates SEO blog posts for the sites connected to this account.',
  'Use it to pull finished articles into the content layer this repository already has —',
  'MDX files, a CMS, whatever is here — instead of embedding grove\'s own blog.',
  '',
  'Normal flow:',
  '1. list_sites — see which domains this key can read.',
  '2. pull_new — the articles not yet delivered to this layer, already formatted.',
  '   Prefer it over list_posts: it is the incremental sync and it will not re-hand you',
  '   something you have already imported.',
  '3. Write each one into the layer using its own conventions (existing frontmatter keys,',
  '   image handling, routing). Match the surrounding content — do not invent a new shape.',
  '4. record_delivery — tell grove the live URL. That is what makes the next pull_new correct,',
  '   and it is how the customer sees on their dashboard that the content shipped.',
  '5. set_canonical_base once, when the layer serves articles at a stable base URL. Grove then',
  '   points every canonical, sitemap, RSS and social link at the customer\'s own URLs so the',
  '   search equity compounds on their domain rather than on grove\'s mirror.',
  '',
  'Two things are easy to get wrong: keep the analytics beacon from integration_guide on the',
  'rendered page (grove\'s reporting and its monthly strategy loop run on it), and never rewrite',
  'the article body to something the manager gate never scored.',
].join('\n');

export function initializeResult(params: Record<string, unknown> | undefined) {
  return {
    protocolVersion: negotiateProtocol(params?.protocolVersion),
    capabilities: {
      // listChanged: grove's tool set is static per deployment, so there is
      // nothing to notify about and claiming otherwise would have clients
      // subscribe to a notification that never arrives.
      tools: { listChanged: false },
      resources: { listChanged: false, subscribe: false },
    },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  };
}

// ── tool results ───────────────────────────────────────────────────────────
// A tool that fails is NOT a JSON-RPC error: the protocol reserves those for
// the call itself going wrong (bad method, malformed params). A tool that ran
// and reported "no such post" must come back as a normal result with
// isError:true, so the model sees the message and can correct itself instead of
// the client surfacing a transport failure.

export type ToolContent = { type: 'text'; text: string };

export type ToolResult = {
  content: ToolContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export function toolText(text: string, structured?: unknown): ToolResult {
  return { content: [{ type: 'text', text }], ...(structured === undefined ? {} : { structuredContent: structured }) };
}

/**
 * JSON payloads go out twice on purpose: `structuredContent` for clients that
 * support it (2025-06-18) and the same object pretty-printed as text for the
 * ones that don't. Sending only the structured field makes the tool look empty
 * to older clients.
 */
export function toolJson(value: unknown): ToolResult {
  return toolText(JSON.stringify(value, null, 2), value);
}

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}
