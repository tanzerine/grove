/**
 * The catalog: what grove's MCP server offers, and how a call's arguments are
 * validated before anything touches the database.
 *
 * The descriptions in this file are not documentation — they are the prompt.
 * They are the only thing an agent reads before deciding which tool to call
 * and what to do with the result, so they say what the tool is FOR and what
 * the agent should do next, not just what shape comes back.
 *
 * Each tool carries its input schema twice: a JSON Schema literal (the wire
 * format MCP requires) and a zod schema (what actually parses the call). They
 * are adjacent so drift is visible, and tests/mcp-tools.test.ts fails if their
 * property names or required lists ever disagree.
 */
import { z } from 'zod';
import { RpcError, RPC } from './protocol';
import { ARTICLE_FORMATS } from './format';

export const SERVER_NAME = 'grove';
export const SERVER_VERSION = '1.0.0';

/**
 * Shown to the model by most clients right after connecting. This is where the
 * integration's non-obvious contract goes — the two things an agent would
 * otherwise get wrong, and that no individual tool description is the right
 * place for.
 */
export const SERVER_INSTRUCTIONS = `Grove writes and publishes SEO articles for this site. This server exists so the articles can live inside the site's OWN content layer — its own routes, components and styles — instead of an embedded widget.

Start with describe_blog. It reports where the articles are canonical today and what is missing.

Two things are easy to get wrong:

1. Keep groveSlug and groveChecksum in whatever frontmatter you write. They are how the next sync tells a current file from a stale one. Rename every other field to match the site's existing convention.

2. An article rendered on this site only earns search credit for it if grove KNOWS that URL. After the first sync, call set_article_base with the URL your articles are served at. That flips every canonical, sitemap entry, RSS item, JSON-LD block and social link grove emits over to your domain. Skipping it leaves grove's mirror canonical, and the content competes with itself.

Also install the analytics beacon from integration_kit. Reads collected there feed the monthly strategy that decides what gets written next — an article nobody can prove was read is an article grove plans against blind.`;

export type ToolSpec = {
  name: string;
  title: string;
  description: string;
  /** JSON Schema sent to the client. */
  inputSchema: Record<string, unknown>;
  /** Parser for the arguments actually received. */
  args: z.ZodTypeAny;
  /** MCP annotation: does calling this change anything on grove's side? */
  readOnly: boolean;
};

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

export const TOOLS: ToolSpec[] = [
  {
    name: 'describe_blog',
    title: 'Describe this blog',
    description:
      'Start here. Returns the domain grove publishes for, the business and byline articles are written under, the brand palette, how many articles are published, the genres in use, and — most importantly — where articles are canonical right now and what is left to set up. Call this before writing any code: it tells you whether this site is already serving grove content, and what the remaining step is.',
    inputSchema: objectSchema({}),
    args: z.object({}),
    readOnly: true,
  },
  {
    name: 'list_articles',
    title: 'List published articles',
    description:
      'The inventory: every published article with its title, excerpt, dates, genre, byline, cover image, canonical URL, reading time and content checksum. The checksum identifies this VERSION of the article — store it as groveChecksum in the file you write and a later plan_sync can tell current files from stale ones without re-reading anything. Use `since` for an incremental pull, `q` to filter by title, and paginate with `offset` when `has_more` is true.',
    inputSchema: objectSchema({
      since: { type: 'string', description: 'ISO date or timestamp. Only articles published or updated after it.' },
      q: { type: 'string', description: 'Case-insensitive title filter.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    }),
    args: z.object({
      since: z.string().min(4).optional(),
      q: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).max(10_000).optional(),
    }),
    readOnly: true,
  },
  {
    name: 'get_article',
    title: 'Get one article',
    description:
      'One article, in the shape your content layer wants. `mdx` (default) and `md` return a ready-to-commit file: YAML frontmatter plus the body, with the leading H1 removed because every layout renders its own title. `mdx` additionally escapes the braces and angle brackets that would otherwise fail an MDX build — use it unless your pipeline wants raw markdown. `html` returns grove\'s self-contained article layout (two columns, sticky table of contents, call-to-action) needing no CSS from you. `json` returns the parts separately — body, table of contents, related posts, JSON-LD, call-to-action, palette, post_id — for a layer that composes its own page.',
    inputSchema: objectSchema(
      {
        slug: { type: 'string', description: "The article's slug, as returned by list_articles." },
        format: { type: 'string', enum: ARTICLE_FORMATS, default: 'mdx' },
      },
      ['slug'],
    ),
    args: z.object({
      slug: z.string().min(1).max(300),
      format: z.enum(['mdx', 'md', 'html', 'json']).optional(),
    }),
    readOnly: true,
  },
  {
    name: 'plan_sync',
    title: 'Plan a re-sync',
    description:
      'Given what you already have on disk, returns what to add, what to rewrite, what is already current, and which local files no longer match a published article. Collect `local` by reading the groveSlug/groveChecksum frontmatter out of your content directory — a file without a checksum is reported as needing a rewrite, because nothing can prove it is current. Use this instead of diffing by date: grove only stamps updated_at on a full in-place refresh, so timestamps miss ordinary edits and checksums do not.',
    inputSchema: objectSchema(
      {
        local: {
          type: 'array',
          maxItems: 2000,
          description: 'What your content directory currently holds.',
          items: objectSchema(
            {
              slug: { type: 'string' },
              checksum: { type: 'string', description: 'groveChecksum from the file, if present.' },
              path: { type: 'string', description: 'Where you found it — echoed back in the plan.' },
            },
            ['slug'],
          ),
        },
      },
      ['local'],
    ),
    args: z.object({
      local: z
        .array(
          z.object({
            slug: z.string().min(1).max(300),
            checksum: z.string().max(128).nullish(),
            path: z.string().max(500).nullish(),
          }),
        )
        .max(2000),
    }),
    readOnly: true,
  },
  {
    name: 'integration_kit',
    title: 'Get the integration kit',
    description:
      'The parts of the page that are not the article text: the first-party analytics beacon to drop into your article template (reads feed the strategy that decides what gets written next), the canonical link tag, the JSON-LD block, and the frontmatter field map. Pass `framework` to get the snippet in the right idiom, and `slug` to get a concrete working example wired to a real article instead of placeholders.',
    inputSchema: objectSchema({
      framework: {
        type: 'string',
        enum: ['next', 'astro', 'nuxt', 'sveltekit', 'remix', 'hugo', 'other'],
        description: 'Shapes the snippet idiom. Defaults to a plain script tag.',
      },
      slug: { type: 'string', description: 'Render the example against this article instead of placeholders.' },
    }),
    args: z.object({
      framework: z.enum(['next', 'astro', 'nuxt', 'sveltekit', 'remix', 'hugo', 'other']).optional(),
      slug: z.string().min(1).max(300).optional(),
    }),
    readOnly: true,
  },
  {
    name: 'set_article_base',
    title: 'Tell grove where the articles now live',
    description:
      'Call this once the pages are live. `base_url` is the URL your articles are served at, without the slug — https://example.com/blog if an article is at https://example.com/blog/my-post. Every absolute URL grove emits (canonical, Open Graph, JSON-LD, sitemap, RSS, llms.txt, social posts, embed links) switches to your URLs, and grove\'s hosted copy becomes a non-canonical mirror. Without it the two copies compete and grove\'s ranks. The base must be on this domain or a subdomain of it. Pass an empty string to hand canonical status back to grove.',
    inputSchema: objectSchema(
      {
        base_url: {
          type: 'string',
          description: 'e.g. https://example.com/blog — or "" to revert to grove-hosted canonicals.',
        },
      },
      ['base_url'],
    ),
    args: z.object({ base_url: z.string().max(300) }),
    readOnly: false,
  },
];

export const TOOLS_BY_NAME: Record<string, ToolSpec> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

/** The `tools/list` payload for one tool. */
export function toolWire(tool: ToolSpec) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.readOnly,
      // Only set_article_base writes, and re-writing the same base is a no-op —
      // so nothing here is destructive and everything is safe to retry.
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/**
 * Validate a tool call's arguments.
 *
 * Failures come back as INVALID_PARAMS with zod's own path/message, because
 * "expected number, received string at limit" tells a model how to fix its
 * call and "invalid arguments" does not.
 */
export function parseToolArgs<T = Record<string, unknown>>(tool: ToolSpec, raw: unknown): T {
  const parsed = tool.args.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new RpcError(RPC.INVALID_PARAMS, `invalid arguments for ${tool.name} — ${detail}`);
  }
  return parsed.data as T;
}

/* ─────────────────────────── prompts ─────────────────────────── */

export type PromptSpec = {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  /** Builds the user-role message the client injects. */
  build: (args: Record<string, string>) => string;
};

export const PROMPTS: PromptSpec[] = [
  {
    name: 'integrate_grove',
    title: 'Integrate grove into this codebase',
    description:
      'A step-by-step plan for putting grove-published articles into this site\'s existing blog, using its own components and routes.',
    arguments: [
      { name: 'content_dir', description: 'Where the site keeps content files, if you already know it.', required: false },
    ],
    build: (args) => {
      const dir = args.content_dir?.trim();
      return [
        'Put grove\'s published articles into this codebase\'s existing blog, end to end.',
        '',
        '1. Call describe_blog. Note the domain, the byline, and where articles are canonical right now.',
        `2. Find how this repo already stores and renders blog posts${dir ? ` (start at ${dir})` : ' — the content directory, the frontmatter fields its loader reads, and the article route'}. Match it. Do not introduce a second content pipeline alongside the one that exists.`,
        '3. Call list_articles, then get_article for each one in the format that repo uses. Rename grove\'s frontmatter fields to the ones the existing loader reads — but keep groveSlug and groveChecksum, which is how the next sync recognises these files.',
        '4. Call integration_kit and add the analytics beacon and canonical tag to the article template.',
        '5. Build the site and fix whatever the content pipeline rejects.',
        '6. Once the pages are live, call set_article_base with the URL prefix the articles are served at, so grove points every canonical, sitemap entry and social link at this site instead of its own mirror.',
        '',
        'Report what you changed, which articles you wrote, and the article base you set.',
      ].join('\n');
    },
  },
  {
    name: 'sync_grove',
    title: 'Sync new grove articles',
    description: 'Pull anything grove has published or changed since the last sync into this repo.',
    arguments: [],
    build: () =>
      [
        'Sync this repo with grove.',
        '',
        '1. Read the groveSlug and groveChecksum frontmatter out of every content file that has them.',
        '2. Call plan_sync with that list.',
        '3. Write the files the plan says to add or rewrite, using get_article in the same format the existing files use, and the same frontmatter field names.',
        '4. Leave the "unchanged" list alone. Only act on orphans if the plan reports remote_complete: true, and ask before deleting anything.',
        '5. Build the site to confirm the new content compiles.',
      ].join('\n'),
  },
];

export const PROMPTS_BY_NAME: Record<string, PromptSpec> = Object.fromEntries(
  PROMPTS.map((p) => [p.name, p]),
);

/* ────────────────────────── resources ────────────────────────── */

/** URI of the blog index resource. */
export const INDEX_URI = 'grove://blog';

/** URI of one article as a resource. */
export function articleUri(slug: string): string {
  return `grove://article/${slug}`;
}

/** Slug from an article URI, or null when the URI isn't one of ours. */
export function slugFromUri(uri: string): string | null {
  const m = /^grove:\/\/article\/(.+)$/.exec(String(uri ?? '').trim());
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).trim();
  return slug || null;
}

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'grove://article/{slug}',
    name: 'article',
    title: 'Grove article',
    description: 'One published article as a markdown file with frontmatter.',
    mimeType: 'text/markdown',
  },
];
