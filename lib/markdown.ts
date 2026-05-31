/**
 * Tiny, dependency-free markdown → safe HTML. Good enough for our generated
 * posts (headings, paragraphs, links, lists, blockquotes, code spans, bold/italic).
 * For production we'd swap in remark — for now this keeps the bundle lean.
 */
function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inPara: string[] = [];

  const flushPara = () => {
    if (!inPara.length) return;
    out.push(`<p>${inline(inPara.join(' '))}</p>`);
    inPara = [];
  };
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushPara(); closeList(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    if (/^[-*]\s+/.test(line)) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    closeList();

    if (line.startsWith('> ')) { flushPara(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }

    inPara.push(line);
  }
  flushPara(); closeList();
  return out.join('\n');
}

function inline(s: string): string {
  let x = esc(s);
  x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  x = x.replace(/`([^`]+)`/g, '<code>$1</code>');
  x = x.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  x = x.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return x;
}
