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

/**
 * Drop the body's leading cover image when the surface renders its own cover
 * from cover_image_url — otherwise the cover shows twice (the pipeline's
 * injectCoverIntoBody stores it after the H1, and stripLeadingH1 removes only
 * the heading).
 *
 * Deliberately narrow: only a line that is NOTHING BUT an image whose URL
 * exactly matches the known cover, appearing before any other content, is
 * removed. An author's own leading image (different URL) or a stale cover
 * from a past regenerate deeper in the body is content and stays. Surfaces
 * without their own cover chrome (RSS, dashboard canvas) keep the in-body
 * image by simply not calling this.
 */
export function stripLeadingCoverImage(md: string, coverUrl: string | null | undefined): string {
  if (!md || !coverUrl) return md;
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() !== '');
  if (i === -1) return md;
  const m = lines[i].trim().match(/^!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
  if (!m || m[1] !== coverUrl) return md;
  lines.splice(i, 1);
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
