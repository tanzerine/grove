/**
 * Markdown-lite parser for assistant chat bubbles — pure, client-safe, no
 * dependencies (lib/markdown.ts drags marked + sanitize-html into the
 * client bundle, far too heavy for chat text). Handles exactly what the
 * model is allowed to emit: **bold**, `code`, "-" bullets, numbered lists,
 * and the occasional heading it emits anyway (rendered as a bold line).
 * Output is structured data, not HTML — the panel maps it to React
 * elements, so nothing here can inject markup. Unit-tested.
 */

export type ChatSpan = { text: string; bold?: boolean; code?: boolean };

export type ChatBlock =
  | { kind: 'p'; spans: ChatSpan[] }        // empty spans = paragraph break
  | { kind: 'bullet'; spans: ChatSpan[] }
  | { kind: 'num'; num: string; spans: ChatSpan[] };

/** Split one line into text / **bold** / `code` spans. */
export function parseInline(s: string): ChatSpan[] {
  const out: ChatSpan[] = [];
  const rx = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (let m = rx.exec(s); m; m = rx.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    out.push(tok.startsWith('**')
      ? { text: tok.slice(2, -2), bold: true }
      : { text: tok.slice(1, -1), code: true });
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.filter((sp) => sp.text.length > 0);
}

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) { blocks.push({ kind: 'p', spans: [] }); continue; }

    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) { blocks.push({ kind: 'p', spans: [{ text: heading[1], bold: true }] }); continue; }

    // "- item" / "• item" / "* item" — but NOT "**bold** …" (needs the space
    // after a single marker, which "**" never has).
    const bullet = line.match(/^\s*[-•*]\s+(.+)$/);
    if (bullet && !/^\s*\*\*/.test(line)) {
      blocks.push({ kind: 'bullet', spans: parseInline(bullet[1]) });
      continue;
    }

    const num = line.match(/^\s*(\d{1,2})[.)]\s+(.+)$/);
    if (num) { blocks.push({ kind: 'num', num: num[1], spans: parseInline(num[2]) }); continue; }

    blocks.push({ kind: 'p', spans: parseInline(line) });
  }

  // Collapse runs of blank lines into one break, and trim the edges.
  const isBreak = (b: ChatBlock) => b.kind === 'p' && b.spans.length === 0;
  const collapsed = blocks.filter((b, i) => !(isBreak(b) && (i === 0 || isBreak(blocks[i - 1]))));
  while (collapsed.length && isBreak(collapsed[collapsed.length - 1])) collapsed.pop();
  return collapsed;
}
