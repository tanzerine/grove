/**
 * The tool catalogue — what a customer's agent can actually do with grove.
 *
 * These descriptions are not documentation, they are the prompt: `tools/list`
 * output is the only thing the model reads before deciding which call to make.
 * So each one says what the tool is FOR and, where it matters, which tool to
 * prefer instead — an agent that reaches for list_posts when it wants an
 * incremental sync will re-import the whole blog on every run.
 *
 * Pure data + pure lookups. The handlers (lib/mcp/handlers.ts) hold the DB work.
 */
import { FORMATS, FRONTMATTER_STYLES } from './format';
import type { Scope } from './keys';

type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  /** Minimum scope the key must carry. Everything read-only is 'read'. */
  scope: Scope;
  annotations?: Record<string, boolean>;
};

const site = { type: 'string', description: 'Site hostname or domain id. Optional when the key can see only one site.' };
const formatProp = {
  type: 'string',
  enum: [...FORMATS],
  description: "Output shape. 'md' or 'mdx' for a file-based blog (mdx escapes { and < outside code so the build survives), 'html' for a layer that stores rendered HTML, 'json' for a CMS import script. Default 'md'.",
};
const frontmatterProp = {
  type: 'string',
  enum: [...FRONTMATTER_STYLES],
  description: "Whether to prepend YAML frontmatter. Use 'none' when the layer stores fields separately from the body. Default 'yaml'.",
};
const fieldMapProp = {
  type: 'object',
  description:
    'Rename or drop frontmatter keys to match the layer\'s existing schema, e.g. {"description":"excerpt","genre":null}. Keys: title, description, slug, date, updated, author, genre, cover, cover_credit, canonical, grove_id. Map to null to omit.',
  additionalProperties: { type: ['string', 'null'] },
};

export const TOOLS: ToolDef[] = [
  {
    name: 'list_sites',
    title: 'List sites',
    description:
      'The domains this key can read, with how many articles are published, how many have already been delivered to your content layer, and where grove currently points its canonical URLs. Start here. Read `key_scope` before you conclude anything about how many sites the account has: a key pinned to one site returns one site.',
    scope: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'pull_new',
    title: 'Pull new articles',
    description:
      'The published articles that have NOT been recorded as delivered to this content layer yet, already formatted for it. This is the incremental sync — use it for routine imports instead of list_posts, and call record_delivery afterwards so the next pull returns only what is genuinely new. Returns the full body for each article, so keep the limit small.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        site,
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many articles to return. Default 5.' },
        format: formatProp,
        frontmatter: frontmatterProp,
        field_map: fieldMapProp,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_posts',
    title: 'List posts',
    description:
      'Browse articles as metadata only (no bodies): title, slug, status, dates, delivery state. Use it to answer questions about the blog or to find one specific article — for importing, prefer pull_new. Drafts awaiting review are visible with status=review but are not final; only published articles should reach a live site.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        site,
        status: {
          type: 'string',
          enum: ['published', 'review', 'scheduled', 'all'],
          description: "Default 'published'.",
        },
        query: { type: 'string', description: 'Free-text match on title, topic and slug.' },
        since: { type: 'string', description: 'ISO 8601 timestamp — only articles published or updated after it.' },
        delivered: { type: 'boolean', description: 'true = only already delivered, false = only not yet delivered.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
        offset: { type: 'integer', minimum: 0, description: 'For paging. Default 0.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_post',
    title: 'Get one article',
    description:
      'One article in full, formatted for the content layer, plus the SEO metadata that has to travel with it (meta description, canonical URL, Article JSON-LD, cover image, related articles). Identify it by slug or by grove_id.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Article slug. Either this or id is required.' },
        id: { type: 'string', description: 'Grove post id (the grove_id in frontmatter).' },
        site,
        format: formatProp,
        frontmatter: frontmatterProp,
        field_map: fieldMapProp,
        include_json_ld: { type: 'boolean', description: 'Include the Article @graph to embed in the page head. Default true.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'record_delivery',
    title: 'Record a delivery',
    description:
      'Tell grove that an article is now live on the content layer, and at which URL. Call it after writing each article. This is what makes pull_new incremental, and it is how the customer sees on their dashboard that the content actually shipped. Safe to call again for the same article — it updates the record rather than duplicating it.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Article slug. Either this or id is required.' },
        id: { type: 'string', description: 'Grove post id.' },
        site,
        url: { type: 'string', description: 'The live URL on the customer\'s site, e.g. https://acme.com/blog/my-post.' },
        external_id: { type: 'string', description: "The layer's own id for the entry, if it has one." },
        layer: { type: 'string', description: "What it was written into, e.g. 'mdx', 'sanity', 'wordpress'." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_canonical_base',
    title: 'Point canonicals at this site',
    description:
      'Set the base URL the layer serves articles under, e.g. https://acme.com/blog. Every absolute URL grove emits — rel=canonical, sitemap, RSS, JSON-LD, social posts, embed links — then points at the customer\'s own pages, so search credit compounds on their domain instead of grove\'s mirror. Call this once, after the first articles are live and the URL pattern is settled.',
    scope: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        site,
        base: { type: 'string', description: 'Absolute base URL, no trailing slash. Articles must resolve at {base}/{slug}.' },
      },
      required: ['base'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'post_analytics',
    title: 'Article performance',
    description:
      'How the articles are doing: reads, click-throughs and traffic sources over a window. Grove uses the same first-party event stream to plan next month\'s topics, so this is the number that matters — pass a slug for one article or omit it for the whole site.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        site,
        slug: { type: 'string', description: 'One article. Omit for a site-wide summary.' },
        days: { type: 'integer', minimum: 1, maximum: 365, description: 'Window in days. Default 30.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'integration_guide',
    title: 'Integration guide',
    description:
      'How to wire grove content into this codebase correctly: the analytics beacon the article page must fire (grove\'s reporting and its monthly strategy loop run on it), how canonical URLs should be set, what the frontmatter fields mean, and a worked sync flow. Read this before writing the first integration.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        stack: {
          type: 'string',
          description: "Optional hint about the layer, e.g. 'next-mdx', 'astro', 'sanity', 'wordpress'. Tailors the example.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function toolByName(name: string): ToolDef | null {
  return TOOLS.find((t) => t.name === name) ?? null;
}

/** What `tools/list` returns — the wire shape, without grove's own `scope`. */
export function toolListPayload() {
  return TOOLS.map(({ scope: _scope, ...rest }) => rest);
}
