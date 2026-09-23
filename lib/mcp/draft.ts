/**
 * The pure half of `create_draft`: turning whatever an agent hands over into
 * the body grove stores.
 *
 * An agent drafting an article usually has it as a FILE — YAML frontmatter on
 * top, maybe an H1, maybe not. Grove's posts keep metadata in columns and open
 * the body with the title as its H1 (the reader, the TOC and `forceCanonicalH1`
 * all assume it), so the file shape has to be undone here rather than stored
 * verbatim: frontmatter pasted into body_md renders as a paragraph of
 * `title: "…"` lines on the live article.
 *
 * No I/O, so every shape is testable without a database.
 */

export type DraftInput = { title: string; body_md: string; description?: string | null };
export type Draft = { title: string; body_md: string; description: string | null };

const FRONTMATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Split leading YAML frontmatter off a markdown file. Only flat `key: value`
 *  lines are read — enough for title/description, never a YAML parser. */
export function splitFrontmatter(md: string): { fields: Record<string, string>; body: string } {
  const m = FRONTMATTER.exec(md);
  if (!m) return { fields: {}, body: md };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    fields[kv[1].toLowerCase()] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { fields, body: md.slice(m[0].length) };
}

/**
 * Normalise an agent's draft.
 *
 * - Frontmatter is stripped; its `description` fills the meta description when
 *   the call didn't pass one (the call's own argument wins — it was explicit).
 * - The body opens with `# {title}`. An existing leading H1 is REPLACED, not
 *   kept beside a second one: the title argument is the one the dashboard and
 *   the slug will use, and two H1s is how a draft ships with a stale headline.
 */
export function normalizeDraft(input: DraftInput): Draft {
  const title = input.title.trim().replace(/\s+/g, ' ');
  const { fields, body } = splitFrontmatter(input.body_md.replace(/\r\n/g, '\n'));

  const rest = body.replace(/^\s*\n/, '').replace(/^\s*#\s+[^\n]*\n?/, '').replace(/^\s+/, '');
  const description = (input.description ?? '').trim() || fields.description || null;

  return {
    title,
    body_md: `# ${title}\n\n${rest}`.trimEnd() + '\n',
    description: description ? description.slice(0, 300) : null,
  };
}
