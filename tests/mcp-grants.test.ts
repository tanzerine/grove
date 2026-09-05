/**
 * "Which agents can reach my content?" — and why that is not a row listing.
 *
 * Refresh rotation issues a new token row and revokes the old one, so an agent
 * connected for months is a trail of revoked rows plus one live one. Get this
 * wrong and a customer opening the page sees a dozen entries for one agent,
 * most of them marked revoked, which reads as a breach and is actually just the
 * credential doing what it is supposed to.
 */
import { describe, it, expect } from 'vitest';
import { ago, summarizeGrants, type TokenRow } from '@/lib/mcp/grants';

const NOW = Date.parse('2026-09-05T12:00:00Z');
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86400_000).toISOString();

const row = (over: Partial<TokenRow> = {}): TokenRow => ({
  id: 'tok-1',
  client_id: 'gvc_agent',
  scopes: ['posts:read', 'posts:write'],
  created_at: iso(1),
  last_used_at: iso(1),
  last_tool: 'pull_new',
  calls: 3,
  revoked_at: null,
  expires_at: iso(-30),
  ...over,
});

describe('rotation is one grant, not many', () => {
  // One agent, authorised 90 days ago, refreshed twice since.
  const lineage: TokenRow[] = [
    row({ id: 't3', created_at: iso(2), last_used_at: iso(0), calls: 4, last_tool: 'list_sites' }),
    row({ id: 't2', created_at: iso(40), last_used_at: iso(2), calls: 10, revoked_at: iso(2) }),
    row({ id: 't1', created_at: iso(90), last_used_at: iso(40), calls: 7, revoked_at: iso(40) }),
  ];

  it('collapses the lineage into a single entry', () => {
    const [g] = summarizeGrants(lineage, { gvc_agent: 'Claude Code' }, NOW);
    expect(summarizeGrants(lineage, {}, NOW)).toHaveLength(1);
    expect(g.name).toBe('Claude Code');
    expect(g.active).toBe(true);
    expect(g.rotations).toBe(2);
  });

  it('dates the grant from the first approval, not the last refresh', () => {
    // The bug this exists to prevent: reporting "connected 2 days ago" for an
    // agent the customer authorised three months ago.
    const [g] = summarizeGrants(lineage, {}, NOW);
    expect(g.connectedAt).toBe(iso(90));
  });

  it('totals usage across every token the agent has held', () => {
    const [g] = summarizeGrants(lineage, {}, NOW);
    expect(g.calls).toBe(21);
    expect(g.lastUsedAt).toBe(iso(0));
    expect(g.lastTool).toBe('list_sites');
  });
});

describe('what counts as live', () => {
  it('is dead once every row is revoked', () => {
    const [g] = summarizeGrants([row({ revoked_at: iso(0) })], {}, NOW);
    expect(g.active).toBe(false);
    expect(g.expiresAt).toBeNull();
  });

  it('is dead once the live row has expired on its own', () => {
    // Expiry and revocation both end access; the list must not show a lapsed
    // token as something still reaching the customer's content.
    const [g] = summarizeGrants([row({ expires_at: iso(1) })], {}, NOW);
    expect(g.active).toBe(false);
  });

  it('reads scopes from the live row, not a wider revoked one', () => {
    const [g] = summarizeGrants(
      [
        row({ id: 'live', scopes: ['posts:read'], created_at: iso(1) }),
        row({ id: 'old', scopes: ['posts:read', 'posts:write'], created_at: iso(9), revoked_at: iso(1) }),
      ],
      {}, NOW,
    );
    expect(g.canWrite).toBe(false);
  });
});

describe('ordering and naming', () => {
  it('puts live grants above disconnected ones', () => {
    const gs = summarizeGrants(
      [
        row({ client_id: 'gvc_dead', revoked_at: iso(0), created_at: iso(1) }),
        row({ client_id: 'gvc_live', created_at: iso(30) }),
      ],
      {}, NOW,
    );
    expect(gs.map((g) => g.clientId)).toEqual(['gvc_live', 'gvc_dead']);
  });

  it('falls back to a neutral name for a client row that has gone', () => {
    const [g] = summarizeGrants([row()], {}, NOW);
    expect(g.name).toBe('An MCP client');
  });

  it('says nothing at all when there is nothing', () => {
    expect(summarizeGrants([], {}, NOW)).toEqual([]);
  });
});

describe('ago', () => {
  it('degrades from minutes to days', () => {
    expect(ago(null, NOW)).toBe('never');
    expect(ago(new Date(NOW - 10_000).toISOString(), NOW)).toBe('just now');
    // The boundary is 30s, not 60: minutes are ROUNDED, so half a minute is
    // already "1m ago". Lifted verbatim from KeyManager rather than changed —
    // this is a shared helper now, and quietly altering how one list renders
    // time is not the business of a PR about revoking grants.
    expect(ago(new Date(NOW - 30_000).toISOString(), NOW)).toBe('1m ago');
    expect(ago(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
    expect(ago(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe('3h ago');
    expect(ago(iso(4), NOW)).toBe('4d ago');
  });
});
