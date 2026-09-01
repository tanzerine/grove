import { describe, it, expect } from 'vitest';
import { KEY_PLACEHOLDER, SERVER_NAME, installCommand, mcpJson } from '../lib/mcp/install';

/**
 * These two strings are copied into a terminal or a config file and never seen
 * again, so a typo here fails on the customer's machine with nothing to debug
 * it from. Both call sites (the onboarding offer and /dashboard/mcp) render
 * whatever this module returns, verbatim.
 */
const ENDPOINT = 'https://trygroveai.com/api/mcp';

describe('installCommand', () => {
  it('carries the endpoint and the key in an Authorization header', () => {
    const cmd = installCommand(ENDPOINT, 'gv_mcp_abc123');
    expect(cmd).toBe(
      'claude mcp add --transport http grove https://trygroveai.com/api/mcp' +
      ' --header "Authorization: Bearer gv_mcp_abc123"',
    );
  });

  it('falls back to a placeholder that is not a usable key', () => {
    expect(installCommand(ENDPOINT)).toContain(KEY_PLACEHOLDER);
    // Real keys are `gv_mcp_` + 43 base64url chars; the placeholder must not be
    // mistaken for one if it is pasted by accident.
    expect(KEY_PLACEHOLDER).toMatch(/YOUR_KEY$/);
  });
});

describe('mcpJson', () => {
  it('is valid JSON with an http server entry under the same name', () => {
    const parsed = JSON.parse(mcpJson(ENDPOINT, 'gv_mcp_abc123'));
    expect(parsed.mcpServers[SERVER_NAME]).toEqual({
      type: 'http',
      url: ENDPOINT,
      headers: { Authorization: 'Bearer gv_mcp_abc123' },
    });
  });

  it('is pretty-printed — it gets pasted into a config file a human edits', () => {
    expect(mcpJson(ENDPOINT)).toContain('\n  "mcpServers"');
  });
});
