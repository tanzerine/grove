import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// GitHub-flavored markdown: tables, task lists, autolinks, line-break = <br>.
marked.setOptions({ gfm: true, breaks: false });

// marked does NOT sanitize — raw HTML in the source (incl. <script> or an
// onerror= handler) passes straight through. Article bodies come from the LLM
// (promptable) and from human-written drafts, and the rendered HTML is injected
// via dangerouslySetInnerHTML on public blogs, the embed API (which lands on
// customers' own domains), and the dashboard. So every parse runs through an
// allowlist sanitizer before it can reach a DOM.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'br',
    'strong', 'em', 'b', 'i', 'del', 's', 'sub', 'sup',
    'code', 'pre', 'span',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'input', // gfm task-list checkboxes
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel', 'name'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    h1: ['id'], h2: ['id'], h3: ['id'], h4: ['id'], h5: ['id'], h6: ['id'],
    code: ['class'], pre: ['class'], span: ['class'],
    td: ['colspan', 'rowspan', 'align'], th: ['colspan', 'rowspan', 'align'],
    input: ['type', 'checked', 'disabled'],
  },
  // href schemes: drop javascript:/data:/vbscript:; images http(s) only.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard', // also drops <script>/<style> content by default
  // <input> is allowlisted only for gfm task-list checkboxes — raw HTML in a
  // draft must not render live form fields (<input type="text">) on a blog.
  exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs?.type !== 'checkbox',
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s가-힣-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

const stripMdLinks = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/**
 * Heading-id generator shared (by construction) between mdToHtml and
 * extractToc — the two MUST emit identical ids or ToC anchors dangle.
 * Duplicate heading text is common in generated posts ("Pros"/"Cons" repeated
 * per option in a comparison); duplicates get -2, -3… suffixes, and both
 * sides count every heading level so the sequences stay aligned.
 */
function headingIdFactory() {
  const used = new Map<string, number>();
  return (text: string) => {
    const base = slugify(stripMdLinks(text)) || 'section';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
}

// Renderer is built per-parse: heading ids carry dedupe state that must reset
// for every document. Links: every external link opens in a new tab (blogs may
// embed back to the customer's site, but external citation links should pop).
function makeRenderer() {
  const renderer = new marked.Renderer();
  const nextId = headingIdFactory();
  const originalLink = renderer.link.bind(renderer);
  renderer.link = (token) => {
    const html = originalLink(token);
    const href = token.href ?? '';
    if (/^https?:\/\//.test(href)) {
      return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
    }
    return html;
  };
  const originalHeading = renderer.heading.bind(renderer);
  renderer.heading = (token) => {
    const html = originalHeading(token);
    return html.replace(/^<h([1-6])>/, (_m, lvl) => `<h${lvl} id="${nextId(token.text)}">`);
  };
  return renderer;
}

export function mdToHtml(md: string): string {
  if (!md) return '';
  const raw = marked.parse(md, { renderer: makeRenderer(), async: false }) as string;
  return sanitizeHtml(raw, SANITIZE_OPTS);
}

export type TocItem = { id: string; text: string; level: 2 | 3 };

/**
 * Extract H2/H3 headings from markdown for a table of contents.
 * Skips the H1 (article title — already shown above the body).
 * Ignores fenced code blocks so `# foo` inside code isn't picked up.
 */
export function extractToc(md: string): TocItem[] {
  if (!md) return [];
  const items: TocItem[] = [];
  const nextId = headingIdFactory();
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Match ALL heading levels so the dedupe counter stays aligned with
    // mdToHtml (which assigns ids to h1–h6), then emit only H2/H3.
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = stripMdLinks(m[2]).trim();
    if (!text) continue;
    const id = nextId(text);
    if (level !== 2 && level !== 3) continue;
    items.push({ id, text, level: level as 2 | 3 });
  }
  return items;
}
