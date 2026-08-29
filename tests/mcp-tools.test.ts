/**
 * The tool catalogue is a prompt, not a manifest.
 *
 * `tools/list` output is the only thing a customer's agent reads before it
 * decides what to call, so a tool whose schema and description have drifted
 * apart doesn't fail loudly — it just gets used wrongly, on someone else's
 * codebase, where nobody here can see it. These checks keep the catalogue
 * self-consistent and keep the two state-changing tools behind write scope.
 */
import { describe, it, expect } from 'vitest';
import { TOOLS, TOOL_NAMES, toolByName, toolListPayload } from '@/lib/mcp/tools';
import { FORMATS } from '@/lib/mcp/format';
import { integrationGuide, normalizeStack } from '@/lib/mcp/guide';

describe('catalogue', () => {
  it('has unique, snake_case names', () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    for (const n of TOOL_NAMES) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('describes every tool well enough to choose it', () => {
    for (const t of TOOLS) {
      expect(t.title.length, t.name).toBeGreaterThan(2);
      // Short enough to skim, long enough to say what it is FOR.
      expect(t.description.length, t.name).toBeGreaterThan(60);
      // The dashboard renders the first sentence as the human-facing summary.
      expect(t.description.split('. ')[0].length, t.name).toBeGreaterThan(20);
    }
  });

  it('declares a valid object schema, with every required field present in properties', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema.type, t.name).toBe('object');
      expect(typeof t.inputSchema.properties, t.name).toBe('object');
      for (const req of t.inputSchema.required ?? []) {
        expect(Object.keys(t.inputSchema.properties), `${t.name}.${req}`).toContain(req);
      }
    }
  });

  it('offers every format the formatter implements, wherever format is accepted', () => {
    // A drift here means the schema advertises a format formatPost silently
    // falls back from, or hides one that works.
    const withFormat = TOOLS.filter((t) => 'format' in t.inputSchema.properties);
    expect(withFormat.length).toBeGreaterThan(0);
    for (const t of withFormat) {
      const en = (t.inputSchema.properties.format as any).enum;
      expect(new Set(en), t.name).toEqual(new Set(FORMATS));
    }
  });

  it('keeps exactly the two state-changing tools behind write scope', () => {
    const writes = TOOLS.filter((t) => t.scope === 'write').map((t) => t.name).sort();
    expect(writes).toEqual(['record_delivery', 'set_canonical_base']);
    // Everything else must be annotated read-only, which is what a client uses
    // to decide whether a call needs the human's approval.
    for (const t of TOOLS.filter((x) => x.scope === 'read')) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
    }
    for (const t of TOOLS.filter((x) => x.scope === 'write')) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(false);
      // Both are upserts — a retried batch must not read as destructive.
      expect(t.annotations?.idempotentHint, t.name).toBe(true);
    }
  });

  it('does not leak grove\'s own scope field onto the wire', () => {
    for (const t of toolListPayload() as any[]) {
      expect(t.scope).toBeUndefined();
      expect(t.name).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it('looks tools up by name and returns null for anything else', () => {
    expect(toolByName('pull_new')?.name).toBe('pull_new');
    expect(toolByName('drop_tables')).toBeNull();
  });

  it('points the routine import at pull_new rather than list_posts', () => {
    // The single most costly misuse: an agent that syncs with list_posts
    // re-imports the whole archive on every run.
    expect(toolByName('pull_new')!.description).toContain('list_posts');
    expect(toolByName('list_posts')!.description).toContain('pull_new');
  });
});

describe('integrationGuide', () => {
  const base = { appBase: 'https://trygroveai.com', hostname: 'acme.com' };

  it('always ships the beacon — the thing that breaks invisibly', () => {
    for (const stack of ['next-mdx', 'astro', 'sanity', 'wordpress', undefined]) {
      const g = integrationGuide({ ...base, stack });
      expect(g, String(stack)).toContain('groveBeacon');
      expect(g, String(stack)).toContain('https://trygroveai.com/api/track');
      expect(g, String(stack)).toContain('record_delivery');
    }
  });

  it('asks for the canonical only while grove still owns it', () => {
    const unset = integrationGuide({ ...base, canonicalBase: null });
    expect(unset).toContain('set_canonical_base');
    const set = integrationGuide({ ...base, canonicalBase: 'https://acme.com/blog' });
    // Already done — telling them to do it again invites a pointless change to
    // a setting that is already right.
    expect(set).toContain('Nothing more to do');
  });

  it('recognises a stack from a loose hint', () => {
    expect(normalizeStack('Next.js with MDX')).toBe('next-mdx');
    expect(normalizeStack('nextjs')).toBe('next');
    expect(normalizeStack('WordPress')).toBe('wordpress');
    expect(normalizeStack('wp')).toBe('wordpress');
    expect(normalizeStack('Astro')).toBe('astro');
    expect(normalizeStack('some in-house thing')).toBe('generic');
    expect(normalizeStack(undefined)).toBe('generic');
  });

  it('warns against rewriting the article the manager gate scored', () => {
    expect(integrationGuide(base)).toContain('Rewrite the body');
  });
});
