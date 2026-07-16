/**
 * The body/title contract for article markdown.
 *
 * Pipeline drafts store the title as the body's first heading (`# Title`) —
 * the validator (MISSING_H1), the manager rubric (title_h1_sync), and cover
 * injection (image goes right after the H1) all rely on it. But every surface
 * that renders the title in its own chrome (dashboard canvas, /b post page,
 * embed API, RSS) must strip that leading H1 or the title prints twice.
 *
 * Kept dependency-free (no marked/sanitize-html) so the client-side editor
 * can import it without dragging the whole markdown pipeline into the bundle.
 */

/** Drop the body's leading H1. Only a `#` heading before any other content
 *  counts — an H1 later in the body is the author's own and stays. */
export function stripLeadingH1(md: string): string {
  if (!md) return md;
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i >= 0 && /^#\s+/.test(lines[i].trim())) lines.splice(i, 1);
  return lines.join('\n');
}

/** Re-attach the title as the body's leading H1 (the stored form). No-op on
 *  an empty title so a titleless draft never gains a blank `# ` line. */
export function withTitleH1(title: string, body: string): string {
  const t = title.trim();
  if (!t) return body;
  const b = body.replace(/^\s*\n/, '');
  return `# ${t}\n\n${b}`;
}
