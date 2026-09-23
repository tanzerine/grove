import { describe, it, expect } from 'vitest';
import {
  KEY_PLACEHOLDER, SERVER_NAME, installCommand, keyInstallCommand, keyMcpJson, mcpJson,
} from '../lib/mcp/install';

/**
 * These strings are copied into a terminal or a config file and never seen
 * again, so a typo here fails on the customer's machine with nothing to debug
 * it from. Both call sites (the onboarding offer and /dashboard/mcp) render
 * whatever this module returns, verbatim.
 */
const ENDPOINT = 'https://trygroveai.com/api/mcp';

describe('installCommand (browser-approved default)', () => {
  it('is the endpoint and nothing else — no key, no header', () => {
    expect(installCommand(ENDPOINT)).toBe('claude mcp add --transport http grove https://trygroveai.com/api/mcp');
  });

  it('is identical for every customer, so it can be published anywhere', () => {
    expect(installCommand(ENDPOINT)).not.toMatch(/gv_mcp_|Authorization|--header/);
  });
});

describe('mcpJson (browser-approved default)', () => {
  it('is a bare http entry — the client runs the OAuth flow on first use', () => {
    expect(JSON.parse(mcpJson(ENDPOINT)).mcpServers[SERVER_NAME]).toEqual({ type: 'http', url: ENDPOINT });
  });

  it('is pretty-printed — it gets pasted into a config file a human edits', () => {
    expect(mcpJson(ENDPOINT)).toContain('\n  "mcpServers"');
  });
});

describe('headless key variants', () => {
  it('extend the default command with an Authorization header', () => {
    expect(keyInstallCommand(ENDPOINT, 'gv_mcp_abc123')).toBe(
      'claude mcp add --transport http grove https://trygroveai.com/api/mcp' +
      ' --header "Authorization: Bearer gv_mcp_abc123"',
    );
  });

  it('fall back to a placeholder that is not a usable key', () => {
    expect(keyInstallCommand(ENDPOINT)).toContain(KEY_PLACEHOLDER);
    // Real keys are `gv_mcp_` + 43 base64url chars; the placeholder must not be
    // mistaken for one if it is pasted by accident.
    expect(KEY_PLACEHOLDER).toMatch(/YOUR_KEY$/);
  });

  it('put the key in the mcp.json headers under the same server name', () => {
    expect(JSON.parse(keyMcpJson(ENDPOINT, 'gv_mcp_abc123')).mcpServers[SERVER_NAME]).toEqual({
      type: 'http',
      url: ENDPOINT,
      headers: { Authorization: 'Bearer gv_mcp_abc123' },
    });
  });
});
