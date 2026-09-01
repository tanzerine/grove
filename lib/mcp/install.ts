/**
 * The two snippets that connect a customer's coding agent to grove.
 *
 * They live here, not at a call site, because there are now two places that
 * hand them over — the first-run onboarding step and /dashboard/mcp — and a
 * customer who copies the onboarding one and later re-copies from the
 * dashboard must get the same command. A drifted flag or a renamed server
 * would look like a grove bug from inside their agent, where there is nothing
 * to debug it with.
 *
 * Pure string building, so both shapes are unit-testable without a browser.
 */

/** The server name the agent will know grove by. Same in both snippets. */
export const SERVER_NAME = 'grove';

/** Shown before a key exists, so the customer can see what they're agreeing to
 *  before minting a credential. Deliberately not a valid key shape. */
export const KEY_PLACEHOLDER = 'gv_mcp_YOUR_KEY';

/** `claude mcp add …` — one line, run in the repo that holds their blog. */
export function installCommand(endpoint: string, token: string = KEY_PLACEHOLDER): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${endpoint} --header "Authorization: Bearer ${token}"`;
}

/** The mcp.json block for clients configured by file rather than by CLI. */
export function mcpJson(endpoint: string, token: string = KEY_PLACEHOLDER): string {
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
