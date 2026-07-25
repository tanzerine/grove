/**
 * Pure prompt/markdown helpers shared by every illustration path — the
 * pipeline's inline-image step (`lib/pipeline/inline-images.ts`) and the Write
 * editor's on-demand image tool (`/api/images/illustration`). Kept free of
 * Replicate/Supabase imports so it's trivially unit-testable, and so both
 * paths render in the SAME house style instead of drifting apart.
 */

/** House style for in-article illustrations. One definition, both callers. */
export const ILLUSTRATION_STYLE = `editorial illustration style — clean, modern, minimalist composition,
soft gradient background, restrained palette of 2-3 muted colors,
geometric shapes and subtle textures, no text, no people, landscape 16:9`;

const MAX_SUBJECT = 600;

/**
 * Compose the final image-model prompt: art-directed subject + house style.
 * Returns '' for an empty subject — a style-only prompt renders a pretty
 * gradient that illustrates nothing, so callers should treat it as invalid.
 */
export function buildIllustrationPrompt(subject: string, style: string = ILLUSTRATION_STYLE): string {
  const s = (subject ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, MAX_SUBJECT);
  if (!s) return '';
  // The LLM art director is told the style already; don't repeat it if it did.
  if (s.includes('editorial illustration style')) return s;
  return `${s.replace(/[.,;]+$/, '')}, ${style}`;
}

/**
 * Alt text that can't break the surrounding markdown: `[`/`]`/`(`/`)` and
 * newlines are what turn `![alt](url)` into garbage when a heading or a pasted
 * sentence is used verbatim.
 */
export function sanitizeAlt(text: string | null | undefined, max = 90): string {
  const cleaned = (text ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[[\]()]/g, '')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Illustration';
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trim();
}

/** A markdown image line with alt text that is always safe to serialize. */
export function imageMarkdown(alt: string | null | undefined, url: string): string {
  const href = (url ?? '').trim();
  if (!href) return '';
  return `![${sanitizeAlt(alt)}](${href.includes(' ') ? encodeURI(href) : href})`;
}

export type IllustrationContext = {
  /** What the author typed into the image tool, if anything. */
  hint?: string | null;
  /** Text selected in the canvas when they asked. */
  selection?: string | null;
  /** Nearest heading above the cursor. */
  heading?: string | null;
  /** The draft's title. */
  title?: string | null;
};

export type IllustrationBrief = {
  /** What the picture is *about* — never empty unless there's nothing at all. */
  focus: string;
  source: 'hint' | 'selection' | 'heading' | 'title' | 'none';
};

/**
 * Decide what to illustrate from whatever the editor could offer, most
 * explicit signal first: a typed hint beats the selection, which beats the
 * section heading, which beats the title. Long selections are clamped — the
 * art director only needs the gist.
 */
export function illustrationBrief(ctx: IllustrationContext): IllustrationBrief {
  const clean = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
  const hint = clean(ctx.hint);
  if (hint) return { focus: hint.slice(0, 400), source: 'hint' };
  const selection = clean(ctx.selection);
  if (selection.length >= 12) return { focus: selection.slice(0, 400), source: 'selection' };
  const heading = clean(ctx.heading);
  if (heading) return { focus: heading.slice(0, 200), source: 'heading' };
  const title = clean(ctx.title);
  if (title) return { focus: title.slice(0, 200), source: 'title' };
  return { focus: '', source: 'none' };
}

/** Prompt used when the LLM art director is unavailable or returns nothing. */
export function fallbackSubject(brief: IllustrationBrief): string {
  if (!brief.focus) return '';
  return `abstract visual metaphor for the idea of "${brief.focus}"`;
}
