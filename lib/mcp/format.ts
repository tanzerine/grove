/**
 * Turning a grove article into something a customer's *existing* content layer
 * will accept.
 *
 * The embed answers "show grove's blog on my page". This file answers a
 * different question: "put grove's article into the blog I already have" —
 * MDX in a repo, a CMS import, a headless API. That layer already has a shape,
 * so the job here is to hand over content that drops into it rather than
 * content that needs a wrapper:
 *
 *   md    — frontmatter + markdown, the file-based blog's native form
 *   mdx   — the same, with the two characters that break every MDX build
 *           (`{` and a bare `<`) escaped OUTSIDE code fences
 *   html  — rendered + sanitised, for a layer that stores HTML
 *   json  — fields only, for a CMS import script
 *
 * `field_map` exists because no two thick blogs agree on names: one wants
 * `description`, the next `excerpt`, the third `summary`. Renaming on the way
 * out is a one-line option here and an entire adapter on the customer's side.
 *
 * Pure — no DB, no network — so every branch is unit-testable.
 */
import { mdToHtml } from '@/lib/markdown';
import { stripLeadingH1, stripLeadingCoverImage } from '@/lib/article-body';

export const FORMATS = ['md', 'mdx', 'html', 'json'] as const;
export type Format = (typeof FORMATS)[number];

export const FRONTMATTER_STYLES = ['yaml', 'none'] as const;
export type FrontmatterStyle = (typeof FRONTMATTER_STYLES)[number];

/** What `posts.cover_image_credit` holds. Every field optional: it has had two
 *  shapes over the product's life and both are still in the table. */
export type CoverCredit = {
  name?: string | null;
  source?: string | null;
  model?: string | null;
  profile_url?: string | null;
};

/** The article as the formatters need it — a plain object, not a DB row. */
export type ContentPost = {
  id: string;
  slug: string;
  title: string;
  body_md: string;
  meta_title?: string | null;
  meta_description?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  cover_image_url?: string | null;
  /** `posts.cover_image_credit` is a JSON object — `{name, source, model}` from
   *  the image pipeline, `{name, profile_url}` on older stock covers. It was
   *  typed `string` here, and the test fixture obeyed the type, so nothing ever
   *  saw what production actually stores. */
  cover_image_credit?: CoverCredit | string | null;
  author?: string | null;
  genre?: string | null;
  canonical_url?: string | null;
};

export type FormatOptions = {
  format?: Format;
  frontmatter?: FrontmatterStyle;
  /** Rename or drop frontmatter keys: `{ description: 'excerpt', genre: null }`. */
  field_map?: Record<string, string | null> | null;
};

export type FormattedPost = {
  format: Format;
  /** What to write to disk / POST to the CMS. */
  content: string;
  /** Convenience for agents writing files into a repo. */
  filename: string;
  media_type: string;
};

// ── YAML ───────────────────────────────────────────────────────────────────

/**
 * Every scalar goes out double-quoted. It is louder than YAML needs to be, and
 * it is the only form that cannot be misread: a title containing a colon, a `#`,
 * a leading `-`, or the word `no` all survive verbatim, where bare scalars would
 * become a mapping, a comment, a list item, and `false`.
 */
export function yamlString(v: string): string {
  const esc = String(v)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${esc}"`;
}

function yamlValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== null && x !== undefined && x !== '').map((x) => yamlString(String(x)));
    return items.length ? `[${items.join(', ')}]` : null;
  }
  // An object here would serialise as the literal "[object Object]" — which is
  // how `cover_credit: "[object Object]"` reached a real customer's frontmatter.
  // Dropping the field is always better: a missing key is something a template
  // can test for, a poisoned one renders as garbage on the page.
  if (typeof v === 'object') return null;
  return yamlString(String(v));
}

/**
 * Null/empty entries are dropped rather than emitted as `key: null`. A blog
 * that renders `{frontmatter.cover}` unconditionally shows a broken image for
 * the second; the first it can simply test for.
 */
export function toFrontmatter(fields: Record<string, unknown>, fieldMap?: Record<string, string | null> | null): string {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    const mapped = fieldMap && key in fieldMap ? fieldMap[key] : key;
    if (!mapped) continue; // mapped to null/'' = the layer doesn't want this field
    const val = yamlValue(raw);
    if (val === null) continue;
    lines.push(`${mapped}: ${val}`);
  }
  return `---\n${lines.join('\n')}\n---`;
}

// ── MDX ────────────────────────────────────────────────────────────────────

/**
 * Make a markdown body safe to compile as MDX.
 *
 * MDX reads `{` as the start of a JS expression and `<` as the start of a JSX
 * element, so prose that a markdown renderer shows fine ("pass {} to reset",
 * "when latency < 200ms") fails the customer's *build*. That is the worst
 * possible failure mode for this feature: the import looks like it worked and
 * the site stops deploying.
 *
 * Code is exempt on both counts — a fenced block or an inline span is verbatim
 * in MDX too, and escaping inside it would corrupt the sample. `<` is left
 * alone when it opens something tag-shaped (`<div`, `</p`, `<!--`), because
 * that is HTML the author meant and MDX accepts it.
 */
export function mdxSafe(md: string): string {
  if (!md) return md;
  // Split on fenced blocks and inline spans, keeping the delimiters: odd
  // indices are code, even indices are prose.
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code — verbatim
      return part
        .replace(/([{}])/g, '\\$1')
        .replace(/<(?![A-Za-z/!])/g, '&lt;');
    })
    .join('');
}

// ── the article body ───────────────────────────────────────────────────────

/**
 * The body as the customer's layer wants it: no leading `# Title` and no
 * leading cover image, because their template renders both from fields. This
 * is the same contract every other grove surface follows (lib/article-body).
 */
export function bodyFor(post: ContentPost): string {
  return stripLeadingCoverImage(stripLeadingH1(post.body_md ?? ''), post.cover_image_url).trim();
}

/**
 * The canonical frontmatter set. Names chosen to be the ones most file-based
 * blogs already use (title/description/date/cover/canonical); anything a layer
 * calls differently is one `field_map` entry away.
 *
 * `grove_id` is not decoration: it is the join key that lets a re-import update
 * the existing entry instead of creating a duplicate when the slug has been
 * edited on the customer's side.
 */
/**
 * The credit as one line of text, because frontmatter is a display field.
 *
 * The structured object is not lost — `pull_new` and `get_post` return
 * `cover_image_credit` whole in the article envelope, so an agent that wants
 * the model or the source still has it. What goes in the file is what a reader
 * sees under the image, and that is a sentence.
 *
 * Attribution survives: a stock credit carrying `profile_url` keeps it, since
 * dropping the link is exactly what the licence forbids.
 */
export function creditLine(credit: unknown): string | null {
  if (typeof credit === 'string') return credit.trim() || null;
  if (!credit || typeof credit !== 'object' || Array.isArray(credit)) return null;
  const c = credit as CoverCredit;
  const name = typeof c.name === 'string' ? c.name.trim() : '';
  if (!name) return null;
  const url = typeof c.profile_url === 'string' ? c.profile_url.trim() : '';
  return url ? `${name} (${url})` : name;
}

export function frontmatterFields(post: ContentPost): Record<string, unknown> {
  return {
    title: post.meta_title || post.title,
    description: post.meta_description ?? null,
    slug: post.slug,
    date: post.published_at ?? null,
    updated: post.updated_at ?? null,
    author: post.author ?? null,
    genre: post.genre ?? null,
    cover: post.cover_image_url ?? null,
    cover_credit: creditLine(post.cover_image_credit),
    canonical: post.canonical_url ?? null,
    grove_id: post.id,
  };
}

export function formatPost(post: ContentPost, opts: FormatOptions = {}): FormattedPost {
  const format: Format = FORMATS.includes(opts.format as Format) ? (opts.format as Format) : 'md';
  const style: FrontmatterStyle = opts.frontmatter === 'none' ? 'none' : 'yaml';
  const fields = frontmatterFields(post);
  const body = bodyFor(post);

  if (format === 'json') {
    // The mapped names apply here too: an importer that was written against
    // `excerpt` should get `excerpt` whichever format it asks for.
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      const name = opts.field_map && k in opts.field_map ? opts.field_map[k] : k;
      if (!name || v === null || v === undefined || v === '') continue;
      mapped[name] = v;
    }
    mapped.body_md = body;
    return {
      format,
      content: JSON.stringify(mapped, null, 2),
      filename: `${post.slug}.json`,
      media_type: 'application/json',
    };
  }

  if (format === 'html') {
    const html = mdToHtml(body);
    const head = style === 'yaml' ? `${toFrontmatter(fields, opts.field_map)}\n\n` : '';
    return {
      format,
      // Frontmatter above HTML is what static-site generators with .html pages
      // expect; a CMS asking for HTML passes frontmatter:'none' and gets a bare
      // fragment it can drop straight into a body field.
      content: `${head}${html}\n`,
      filename: `${post.slug}.html`,
      media_type: 'text/html',
    };
  }

  const content = format === 'mdx' ? mdxSafe(body) : body;
  const head = style === 'yaml' ? `${toFrontmatter(fields, opts.field_map)}\n\n` : '';
  return {
    format,
    content: `${head}${content}\n`,
    filename: `${post.slug}.${format}`,
    media_type: 'text/markdown',
  };
}
