/**
 * Turning a grove post into a file a customer's content layer can hold.
 *
 * Everything here is pure — no database, no request — because these are the
 * shapes that end up committed to someone else's repository, and a change to
 * them is a change to every file they've already written.
 *
 * The three jobs:
 *   1. CHECKSUM. The identity of a version of an article, so a re-sync knows
 *      what actually changed instead of rewriting sixty files every night.
 *   2. FRONTMATTER. Grove's fields in the front of the file, including the
 *      checksum, so the next sync can read back what the last one wrote.
 *   3. MDX SAFETY. A brace in an article body is a build failure in an MDX
 *      pipeline; escaping is what makes "just write the file" true.
 */
import { createHash } from 'crypto';

/**
 * Everything the checksum, the frontmatter and the file body are built from.
 * Assembled by lib/mcp/server.ts from the post row plus the derived fields
 * (author, genre, canonical URL) that the customer's page also renders.
 */
export type McpArticle = {
  slug: string;
  title: string;
  body_md: string;
  meta_title: string | null;
  meta_description: string | null;
  published_at: string | null;
  updated_at: string | null;
  cover_image_url: string | null;
  cover_image_credit: string | null;
  author: string;
  genre: string;
  /** Where THIS article is canonical — the customer's own URL once they've set
   *  an article base, grove's mirror until then. */
  canonical_url: string;
  /** For the analytics beacon on the customer's page; pairs with domain_id. */
  post_id: string;
  domain_id: string;
};

/**
 * Fields the checksum covers, in a fixed order. Adding a field here changes
 * every article's checksum and therefore makes the next sync rewrite every
 * file — correct when the new field lands IN the file, wasteful otherwise.
 *
 * `canonical_url` is in the list on purpose: it goes into the frontmatter, so
 * flipping the article base with set_article_base must mark every file stale.
 */
const CHECKSUM_FIELDS: (keyof McpArticle)[] = [
  'slug',
  'title',
  'body_md',
  'meta_title',
  'meta_description',
  'published_at',
  'updated_at',
  'cover_image_url',
  'cover_image_credit',
  'author',
  'genre',
  'canonical_url',
];

/**
 * A short, stable identity for this version of this article.
 *
 * It hashes the BODY, not just the timestamps, and that is the whole point:
 * `posts.updated_at` is only ever written by an in-place refresh, so an
 * article edited any other way keeps every timestamp it had. A checksum built
 * from metadata would call that file up to date forever, and the customer's
 * site would serve the pre-edit copy with no way to notice. Hashing the body
 * costs one full read on the grove side and nothing on the wire — the customer
 * receives 16 characters.
 */
export function articleChecksum(article: Partial<McpArticle>): string {
  const h = createHash('sha256');
  for (const field of CHECKSUM_FIELDS) {
    const v = article[field as keyof McpArticle];
    // Length-prefixed so ("ab","c") and ("a","bc") can't collide.
    const s = v == null ? '' : String(v);
    h.update(`${field}:${s.length}:${s}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

export type ArticleFormat = 'mdx' | 'md' | 'html' | 'json';

export const ARTICLE_FORMATS: ArticleFormat[] = ['mdx', 'md', 'html', 'json'];

/** File extension for a format — used for the suggested path. */
const EXT: Record<ArticleFormat, string> = { mdx: 'mdx', md: 'md', html: 'html', json: 'json' };

/**
 * Where this article would live in a conventional content directory. A
 * suggestion, not a rule: the agent knows the customer's actual layout and is
 * told to prefer it. It exists so a repo with NO existing convention (the
 * customer who is adding a blog for the first time) gets a sane answer.
 */
export function suggestedPath(slug: string, format: ArticleFormat, dir = 'content/blog'): string {
  const clean = dir.replace(/^\/+|\/+$/g, '');
  return `${clean}/${slug}.${EXT[format]}`;
}

/**
 * Serialize a YAML frontmatter block.
 *
 * Every string is double-quoted and escaped rather than emitted bare: article
 * titles contain colons, quotes, `#` and leading `-` often enough that bare
 * scalars would produce a file that parses as something else — or doesn't
 * parse. Null and undefined values are dropped, so a post with no cover has no
 * empty `image:` key for the customer's template to test against.
 */
export function yamlFrontmatter(fields: Record<string, string | number | boolean | null | undefined>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/**
 * Grove's fields, named the way a blog frontmatter usually names them.
 *
 * There is no universal convention (Astro says `pubDate`, Contentlayer says
 * `date`, half the world says `publishedAt`), so this is a documented default
 * that the agent is expected to REMAP to whatever the customer's layer already
 * reads. The two keys that must survive remapping are `groveSlug` and
 * `groveChecksum` — they are how the next sync recognises the file it wrote.
 */
export function articleFrontmatter(article: McpArticle): Record<string, string | number | null> {
  return {
    title: article.title,
    description: article.meta_description,
    date: article.published_at,
    updated: article.updated_at,
    slug: article.slug,
    author: article.author,
    category: article.genre,
    image: article.cover_image_url,
    imageCredit: article.cover_image_credit,
    canonical: article.canonical_url,
    // Identity. Keep these two through any remapping or the next sync has to
    // treat every file as unknown and rewrite it.
    groveSlug: article.slug,
    groveChecksum: articleChecksum(article),
    grovePostId: article.post_id,
  };
}

/**
 * Escape the characters that make an MDX compiler fail on ordinary prose.
 *
 * MDX parses `{…}` as a JS expression and `<…` as JSX, so a body that mentions
 * `{"role": "user"}` or writes `a < b` compiles fine as markdown and breaks the
 * customer's BUILD as MDX. Both are escapable with a backslash, which renders
 * as the literal character.
 *
 * Code is left exactly as written — fenced blocks and inline spans are not
 * MDX-parsed, and escaping inside them would put backslashes in the customer's
 * code samples, which is worse than the problem.
 *
 * The trade-off, stated plainly: a body containing intentional raw HTML gets
 * that HTML escaped into visible text. That is a cosmetic bug on one article,
 * visible the moment anyone looks at it. The alternative is a build that fails
 * on a deploy, which is not visible until it is very visible. `format: "md"`
 * leaves the body byte-identical for layers that want it raw.
 */
export function escapeMdx(body: string): string {
  const lines = body.split('\n');
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return escapeMdxLine(line);
    })
    .join('\n');
}

/** Escape a single line, skipping inline `code` spans. */
function escapeMdxLine(line: string): string {
  let out = '';
  // Split on backtick runs so `a < b` inside code survives untouched; odd
  // segments are the code spans.
  const parts = line.split(/(`+[^`]*`+)/g);
  for (const part of parts) {
    out += part.startsWith('`') ? part : part.replace(/([{}<])/g, '\\$1');
  }
  return out;
}

/**
 * The finished file: frontmatter, then the body.
 *
 * The body arrives with its leading `# Title` already stripped (the title is a
 * frontmatter field and every layout renders its own H1) — see
 * lib/article-body. What's left starts at the first real paragraph.
 */
export function toContentFile(article: McpArticle, format: 'mdx' | 'md'): string {
  const body = format === 'mdx' ? escapeMdx(article.body_md) : article.body_md;
  return `${yamlFrontmatter(articleFrontmatter(article))}\n\n${body.trim()}\n`;
}

/** Word count of a markdown body — CJK-aware enough to not report "1 minute"
 *  for a 3,000-character Korean article, which has no spaces to count. */
export function wordCount(body: string): number {
  const text = String(body ?? '');
  const cjk = (text.match(/[ㄱ-힝一-鿿぀-ヿ]/g) ?? []).length;
  const words = text
    .replace(/[ㄱ-힝一-鿿぀-ヿ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  // ~2.5 CJK characters carry about as much as one English word.
  return words + Math.round(cjk / 2.5);
}

/** Reading time in whole minutes, floor 1. */
export function readMinutes(body: string): number {
  return Math.max(1, Math.round(wordCount(body) / 220));
}
