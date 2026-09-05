/**
 * Turning `oauth_tokens` rows into "which agents can reach my content".
 *
 * THE THING THAT MAKES THIS NON-OBVIOUS: refresh rotates. Every refresh issues
 * a new row and revokes the old one, so a single agent connected for a year is
 * a long trail of revoked rows plus one live one. Listing rows would show a
 * customer dozens of entries for one agent, most of them "revoked" — which
 * reads as a security incident and is actually just Tuesday.
 *
 * So the unit the customer sees is the GRANT, keyed by client_id, which is
 * stable across rotation. `connectedAt` is the earliest row in the lineage, not
 * the newest: "connected 2 minutes ago" for an agent they authorised in March
 * would be a lie told by an implementation detail.
 *
 * Pure. The route does the database work and hands the rows here.
 */

export type TokenRow = {
  id: string;
  client_id: string;
  scopes: string[] | null;
  created_at: string;
  last_used_at: string | null;
  last_tool: string | null;
  calls: number | null;
  revoked_at: string | null;
  expires_at: string;
};

export type Grant = {
  clientId: string;
  name: string;
  /** Live right now: something in the lineage is neither revoked nor expired. */
  active: boolean;
  /** When the customer first approved this agent, not when it last refreshed. */
  connectedAt: string;
  lastUsedAt: string | null;
  lastTool: string | null;
  /** Every call the agent has made, across every token it has held. */
  calls: number;
  canWrite: boolean;
  /** How many times the credential has rotated. Zero for a fresh grant. */
  rotations: number;
  /** When the live token lapses on its own, if there is one. */
  expiresAt: string | null;
};

const usable = (r: TokenRow, now: number) =>
  !r.revoked_at && new Date(r.expires_at).getTime() > now;

const earliest = (a: string, b: string) => (a < b ? a : b);
const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * One entry per agent, newest connection first.
 *
 * Sorted with live grants above dead ones, because the question this list
 * answers — "what can reach my content?" — is about the live ones; the rest is
 * history that should not push the answer below the fold.
 */
export function summarizeGrants(
  rows: TokenRow[],
  names: Record<string, string>,
  now: number = Date.now(),
): Grant[] {
  const byClient = new Map<string, TokenRow[]>();
  for (const r of rows) {
    const list = byClient.get(r.client_id) ?? [];
    list.push(r);
    byClient.set(r.client_id, list);
  }

  const grants: Grant[] = [];
  for (const [clientId, lineage] of byClient) {
    const live = lineage.find((r) => usable(r, now)) ?? null;
    // Scopes come from the live row where there is one: a revoked row may
    // record a wider grant the customer has since cut back.
    const scopeSource = live ?? lineage.reduce((a, b) => (a.created_at > b.created_at ? a : b));

    grants.push({
      clientId,
      name: names[clientId] ?? 'An MCP client',
      active: !!live,
      connectedAt: lineage.map((r) => r.created_at).reduce(earliest),
      lastUsedAt: lineage.map((r) => r.last_used_at).reduce(latest, null),
      lastTool: lineage
        .filter((r) => r.last_tool)
        .sort((a, b) => (a.last_used_at ?? '') < (b.last_used_at ?? '') ? 1 : -1)[0]?.last_tool ?? null,
      calls: lineage.reduce((sum, r) => sum + (r.calls ?? 0), 0),
      canWrite: (scopeSource.scopes ?? []).includes('posts:write'),
      rotations: Math.max(0, lineage.length - 1),
      expiresAt: live?.expires_at ?? null,
    });
  }

  return grants.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.connectedAt < b.connectedAt ? 1 : -1;
  });
}

/**
 * Relative time for a usage trail. Deliberately coarse — "3d ago" is the
 * honest resolution for a counter that is written best-effort.
 */
export function ago(iso: string | null, now: number = Date.now()): string {
  if (!iso) return 'never';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * Display strings, computed once on the SERVER and passed down as data.
 *
 * Both of these are non-deterministic if rendered in a client component:
 * `toLocaleDateString()` with no locale follows the BROWSER's, which is not the
 * language the dashboard is in, and `ago()` reads the clock — so the server's
 * markup and the client's first render disagree and React throws a hydration
 * error. Formatting up front means the component renders pure data and the two
 * passes cannot differ.
 */
export type GrantView = Grant & { connectedLabel: string; lastUsedLabel: string };

export function toView(g: Grant, intlLocale: string, now: number = Date.now()): GrantView {
  return {
    ...g,
    connectedLabel: new Date(g.connectedAt).toLocaleDateString(intlLocale),
    lastUsedLabel: ago(g.lastUsedAt, now),
  };
}
