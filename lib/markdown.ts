import { marked } from 'marked';

// GitHub-flavored markdown: tables, task lists, autolinks, line-break = <br>.
marked.setOptions({ gfm: true, breaks: false });

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

export function mdToHtml(md: string): string {
  if (!md) return '';
  return marked.parse(md, { renderer, async: false }) as string;
}
