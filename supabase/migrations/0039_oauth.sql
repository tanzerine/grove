-- ─────────────────────────────────────────────────────────────
-- 0039_oauth.sql
-- OAuth for the MCP endpoint — phase 1 of taking the credential out of the
-- install command.
--
-- NUMBERED 0039 against the LIVE `supabase migration list` (0001–0038 applied
-- as of 2026-09-05), not against `ls supabase/migrations/`. That directory only
-- knows what this branch knows; 0036 had to be renumbered once already for
-- exactly this reason.
--
-- WHY. Today every customer's install command is unique, because their key is
-- baked into it: mint a key in the dashboard, copy it before it disappears,
-- paste it into a shell, and leave it in ~/.claude.json in cleartext. With
-- OAuth the command is a constant that can sit in a README, the token lands in
-- the OS keychain, and the "which sites may this agent see" question moves from
-- a dropdown nobody reads to a consent screen with the agent's name on it.
--
-- mcp_keys (0036) IS NOT REPLACED. CI, service accounts and anything headless
-- still want a long-lived credential that no browser has to be present for.
-- OAuth becomes the path a human takes; the key stays the path a machine takes.
--
-- OPAQUE TOKENS, NOT JWTs. Same shape as mcp_keys: 32 random bytes, only
-- sha256 stored, looked up by that digest. It costs one indexed read per
-- request — which the bearer-key path already pays — and buys instant
-- revocation with no signing key to rotate, no clock skew, and no dump of this
-- table containing anything replayable.
--
-- RLS ON ALL THREE, WITH NO POLICY — service-role only, exactly like mcp_keys
-- (0036), beta_coupons (0033) and refund_requests (0015). These tables hold
-- credential digests and authorization codes; neither is ever reachable with an
-- anon or user key. Everything that reads them resolves the user server-side
-- first (lib/mcp/auth.ts), and that hand-scoping is the access check.
-- ─────────────────────────────────────────────────────────────

-- ── who is asking ──────────────────────────────────────────────────────────
-- Registered dynamically (RFC 7591): a customer's agent registers itself the
-- first time it connects, which is the whole point — nobody pre-arranges a
-- client id with grove. Registration is deliberately open, and grants nothing:
-- a client that has registered can still do nothing at all until a signed-in
-- human approves it in a browser. That approval is the security boundary, not
-- this row.
create table if not exists public.oauth_clients (
  id             uuid primary key default gen_random_uuid(),
  -- Public identifier the client sends on every authorize/token request.
  client_id      text not null unique,
  -- Self-reported, shown on the consent screen. Rendered as untrusted text:
  -- anyone can register a client claiming any name, so the screen must never
  -- present it as verified.
  client_name    text not null default 'An MCP client',
  -- Exact URIs this client may be redirected back to. Checked at authorize
  -- time AND again at token exchange — an authorization code sent to an
  -- attacker-chosen URI is the classic way this flow is broken.
  redirect_uris  text[] not null,
  grant_types    text[] not null default array['authorization_code','refresh_token']::text[],
  -- Public clients only. A CLI or a desktop app cannot keep a secret, so PKCE
  -- is the proof instead — which is also what OAuth 2.1 requires.
  token_endpoint_auth_method text not null default 'none',
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);

-- ── the code, in flight ────────────────────────────────────────────────────
-- Lives for minutes. Single-use: `consumed_at` is set on the first successful
-- exchange, and a second attempt with the same code is refused — replay of a
-- leaked code (browser history, a proxy log, a shoulder) must not mint a
-- second token.
create table if not exists public.oauth_codes (
  code_hash      text primary key,
  client_id      text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Recorded at issue and compared at exchange: the token request must come
  -- back for the same URI the code was issued against.
  redirect_uri   text not null,
  -- PKCE (RFC 7636). S256 only — 'plain' is accepted by neither OAuth 2.1 nor
  -- this column's check.
  code_challenge text not null,
  code_challenge_method text not null default 'S256'
                 check (code_challenge_method = 'S256'),
  scopes         text[] not null,
  -- RFC 8707. The audience the resulting token is bound to; carried through
  -- the exchange so a token minted here can never be presented elsewhere.
  resource       text not null,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
-- Sweeping expired codes is a background nicety, not a correctness
-- requirement: an expired code is refused on its `expires_at` regardless.
create index if not exists oauth_codes_expiry_idx on public.oauth_codes (expires_at);

-- ── the credential ─────────────────────────────────────────────────────────
create table if not exists public.oauth_tokens (
  id             uuid primary key default gen_random_uuid(),
  -- sha256(access token) hex, unique so auth is one indexed lookup.
  token_hash     text not null unique,
  -- sha256(refresh token). Nullable: a client that asked for no refresh gets
  -- none, and a rotated refresh token replaces this value in place.
  refresh_hash   text unique,
  client_id      text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  scopes         text[] not null,
  resource       text not null,
  expires_at     timestamptz not null,
  -- Set instead of deleting, so "which agents have I connected?" can still show
  -- what was revoked and when.
  revoked_at     timestamptz,
  refresh_expires_at timestamptz,
  -- Same usage trail mcp_keys keeps, so both credential types can appear in one
  -- list on the dashboard without a special case per column.
  last_used_at   timestamptz,
  last_tool      text,
  calls          int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists oauth_tokens_user_idx on public.oauth_tokens (user_id, created_at desc);

comment on column public.oauth_tokens.token_hash is
  'sha256(access token) hex. The token itself is returned exactly once, by the '
  'token endpoint. Auth looks the row up by this digest (lib/mcp/keys.ts '
  'hashKey), so a dump of this table cannot be replayed against /api/mcp.';

comment on column public.oauth_tokens.resource is
  'RFC 8707 audience. lib/mcp/auth.ts refuses a token whose resource is not '
  'this deployment''s own MCP endpoint, so a token minted for another grove '
  'environment cannot be presented here.';

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes   enable row level security;
alter table public.oauth_tokens  enable row level security;

-- All three: deliberately NO policy. See the header.
