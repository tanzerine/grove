/**
 * The tool catalog, and the one duplication in it.
 *
 * Every tool declares its input twice: a JSON Schema literal (what the client
 * is told) and a zod schema (what actually parses the call). They have to be,
 * because MCP wants JSON Schema on the wire and grove parses with zod
 * everywhere else — but two hand-written copies of the same shape drift, and
 * the drift is invisible. A property renamed in zod alone leaves the client
 * confidently sending the old name; a `required` list that disagrees leaves an
 * agent told an argument is optional and rejected for omitting it. Neither
 * shows up in review and neither throws — the agent just gets an error it
 * can't act on, in someone else's terminal.
 *
 * So: the schemas are compared here, key by key, including inside array items.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TOOLS, TOOLS_BY_NAME, toolWire, parseToolArgs, PROMPTS, SERVER_INSTRUCTIONS, slugFromUri, articleUri, INDEX_URI } from '@/lib/mcp/tools';
import { RpcError } from '@/lib/mcp/protocol';

/** Peel ZodOptional/ZodNullable off to reach the type underneath. */
function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = t;
  while (cur instanceof z.ZodOptional || cur instanceof z.ZodNullable) cur = cur.unwrap();
  return cur;
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
};

/** Compare one zod object against one JSON Schema object node, recursively. */
function compare(zodType: z.ZodTypeAny, json: JsonSchema, where: string): void {
  const inner = unwrap(zodType);

  if (inner instanceof z.ZodArray) {
    expect(json.type, `${where} should be an array in JSON Schema`).toBe('array');
    if (json.items) compare(inner.element, json.items, `${where}[]`);
    return;
  }

  if (!(inner instanceof z.ZodObject)) return;

  const shape = inner.shape as Record<string, z.ZodTypeAny>;
  const zodKeys = Object.keys(shape).sort();
  const jsonKeys = Object.keys(json.properties ?? {}).sort();
  expect(jsonKeys, `${where}: property names must match`).toEqual(zodKeys);

  const zodRequired = zodKeys.filter((k) => !shape[k].isOptional()).sort();
  expect([...(json.required ?? [])].sort(), `${where}: required list must match`).toEqual(zodRequired);

  for (const key of zodKeys) {
    const child = json.properties?.[key];
    if (child) compare(shape[key], child, `${where}.${key}`);
  }
}

describe('tool schemas', () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))('%s: JSON Schema and zod agree', (name, tool) => {
    compare(tool.args, tool.inputSchema as JsonSchema, name);
  });

  it.each(TOOLS.map((t) => [t.name, t] as const))('%s: describes itself well enough to be chosen', (_name, tool) => {
    // The description is the only thing an agent reads before deciding to call
    // this tool. A one-liner gets it called at the wrong moment or not at all.
    expect(tool.title.length).toBeGreaterThan(3);
    expect(tool.description.length).toBeGreaterThan(120);
    expect(tool.inputSchema.type).toBe('object');
  });

  it('marks exactly one tool as a write', () => {
    // If this changes, it changes what a leaked key can do. It should be a
    // deliberate decision, not a default someone flipped.
    const writes = TOOLS.filter((t) => !t.readOnly).map((t) => t.name);
    expect(writes).toEqual(['set_article_base']);
  });

  it('exposes the annotations clients use to decide what to auto-approve', () => {
    const wire = toolWire(TOOLS_BY_NAME.list_articles);
    expect(wire.annotations.readOnlyHint).toBe(true);
    expect(wire.annotations.destructiveHint).toBe(false);
    expect(wire.name).toBe('list_articles');
    expect(wire.inputSchema).toBeTruthy();
  });
});

describe('parseToolArgs', () => {
  it('accepts a valid call and fills nothing in that was not sent', () => {
    const args = parseToolArgs<{ slug: string; format?: string }>(TOOLS_BY_NAME.get_article, { slug: 'a-post' });
    expect(args.slug).toBe('a-post');
    expect(args.format).toBeUndefined();
  });

  it('rejects a missing required argument with a message the model can act on', () => {
    try {
      parseToolArgs(TOOLS_BY_NAME.get_article, {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RpcError);
      // "invalid arguments" alone tells a model nothing; the path must be in it.
      expect((err as RpcError).message).toContain('slug');
    }
  });

  it('rejects an out-of-range limit rather than silently clamping it', () => {
    expect(() => parseToolArgs(TOOLS_BY_NAME.list_articles, { limit: 5000 })).toThrow(RpcError);
  });

  it('ignores extra properties instead of failing the call', () => {
    // Agents pass stray fields. Refusing the call over one would be a bad
    // trade for a tool whose arguments are all optional anyway.
    expect(() => parseToolArgs(TOOLS_BY_NAME.list_articles, { limit: 5, nonsense: true })).not.toThrow();
  });

  it('accepts a plan_sync payload with and without checksums', () => {
    const args = parseToolArgs<{ local: unknown[] }>(TOOLS_BY_NAME.plan_sync, {
      local: [{ slug: 'a' }, { slug: 'b', checksum: 'x', path: 'p' }, { slug: 'c', checksum: null }],
    });
    expect(args.local).toHaveLength(3);
  });
});

describe('server instructions', () => {
  it('states the two things an agent otherwise gets wrong', () => {
    // Keeping the checksum through a frontmatter remap, and telling grove
    // where the articles ended up. Both are silent failures if skipped.
    expect(SERVER_INSTRUCTIONS).toContain('groveChecksum');
    expect(SERVER_INSTRUCTIONS).toContain('set_article_base');
  });
});

describe('prompts', () => {
  it('offers a first-integration and a re-sync playbook', () => {
    expect(PROMPTS.map((p) => p.name).sort()).toEqual(['integrate_grove', 'sync_grove']);
  });

  it('tells the agent to match the repo rather than invent a second pipeline', () => {
    const text = PROMPTS[0].build({});
    expect(text).toMatch(/existing|match/i);
    expect(text).toContain('set_article_base');
  });

  it('uses the content directory when the caller supplies one', () => {
    expect(PROMPTS[0].build({ content_dir: 'src/content/posts' })).toContain('src/content/posts');
  });
});

describe('resource uris', () => {
  it('round-trips a slug', () => {
    expect(slugFromUri(articleUri('how-to-brew'))).toBe('how-to-brew');
  });

  it('refuses anything that is not one of ours', () => {
    expect(slugFromUri(INDEX_URI)).toBeNull();
    expect(slugFromUri('https://example.com/a')).toBeNull();
    expect(slugFromUri('grove://article/')).toBeNull();
    expect(slugFromUri('')).toBeNull();
  });
});
