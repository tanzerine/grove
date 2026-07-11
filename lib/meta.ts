/**
 * Meta-description selection. The model usually returns a meta_description, but
 * when it's missing or too thin we want a strong fallback — and we always want
 * to cap length so Google doesn't truncate mid-word. The best standalone line
 * an article already has is its first Key Takeaway, so we reach for that before
 * the brief's promise or the opening paragraph.
 *
 * Pure (reads only its inputs) so it's easy to unit-test.
 */
import { extractTakeaways } from './takeaways';

const MAX = 160;

function clean(s?: string | null): string {
  return (s ?? '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → text
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cap(s: string): string {
  if (s.length <= MAX) return s;
  return s.slice(0, MAX - 1).replace(/\s+\S*$/, '').trimEnd() + '…';
}

/**
 * Cap a post title at a word boundary. Titles are stored verbatim as the H1 and
 * <title>, so a hard character slice ships mid-word truncations ("…Designers
 * Swi") to the live blog — 10 of the first 28 published posts did exactly that.
 * The limit is a runaway guard, not a display target (Google truncates long
 * titles visually on its own); at 140 it should almost never fire.
 */
export function capTitle(s: string, max = 140): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max).replace(/\s+\S*$/, '').trimEnd();
  return (cut || t.slice(0, max).trimEnd()) + '…';
}

export function deriveMetaDescription(opts: {
  modelMeta?: string | null;
  body?: string | null;
  promise?: string | null;
}): string {
  const m = clean(opts.modelMeta);
  if (m.length >= 50) return cap(m); // model gave us a usable description

  // too short / empty → build from the strongest standalone line available
  const takeaway = clean(extractTakeaways(opts.body ?? '')[0]);
  const promise = clean(opts.promise);
  const firstPara = clean(
    (opts.body ?? '').split('\n').find((l) => {
      const t = l.trim();
      return !!t && !t.startsWith('#') && !t.startsWith('>') && !/^(\*\*|__)?key takeaways/i.test(t);
    }) ?? '',
  );
  return cap(takeaway || promise || firstPara || m);
}
