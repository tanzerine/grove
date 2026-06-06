import { marked } from 'marked';

// GitHub-flavored markdown: tables, task lists, autolinks, line-break = <br>.
marked.setOptions({ gfm: true, breaks: false });

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s가-힣-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// Walk the renderer to make every link open in a new tab (since blogs may
// embed back to the customer's site, but external citation links should pop).
const renderer = new marked.Renderer();
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
  const id = slugify(token.text);
  return html.replace(/^<h([1-6])>/, `<h$1 id="${id}">`);
};

export function mdToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { renderer, async: false }) as string;
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
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length as 2 | 3;
    const text = m[2].replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    if (!text) continue;
    items.push({ id: slugify(text), text, level });
  }
  return items;
}
