/**
 * The snippets that connect a customer's coding agent to grove.
 *
 * They live here, not at a call site, because there are two places that hand
 * them over — the first-run onboarding step and /dashboard/mcp — and a
 * customer who copies the onboarding one and later re-copies from the
 * dashboard must get the same command. A drifted flag or a renamed server
 * would look like a grove bug from inside their agent, where there is nothing
 * to debug it with.
 *
 * THE DEFAULT CARRIES NO CREDENTIAL. The endpoint's 401 names its OAuth
 * server (lib/mcp/oauth-metadata.ts), so a spec-current client registers
 * itself, opens a browser on grove's consent screen, and stores the token it
 * gets back. The install string is therefore a constant — the same URL for
 * every customer, nothing to mint first and nothing secret to paste. The key
 * variants exist only for an agent that has no browser to open (CI, a cron
 * job); they are the fallback, never the first thing shown.
 *
 * Pure string building, so every shape is unit-testable without a browser.
 */

/** The server name the agent will know grove by. Same in every snippet. */
export const SERVER_NAME = 'grove';

/** Shown in the headless snippets before a key exists. Deliberately not a
 *  valid key shape. */
export const KEY_PLACEHOLDER = 'gv_mcp_YOUR_KEY';

/** `claude mcp add …` — the browser-approved default. */
export function installCommand(endpoint: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${endpoint}`;
}

/** The mcp.json block for clients configured by file (Cursor and friends).
 *  A bare URL: the client runs the same browser approval on first use. */
export function mcpJson(endpoint: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'http', url: endpoint } } }, null, 2);
}

/** Headless: the same command with a key in an Authorization header. */
export function keyInstallCommand(endpoint: string, token: string = KEY_PLACEHOLDER): string {
  return `${installCommand(endpoint)} --header "Authorization: Bearer ${token}"`;
}

/** Headless mcp.json, for a client that cannot open a browser. */
export function keyMcpJson(endpoint: string, token: string = KEY_PLACEHOLDER): string {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_NAME]: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}
