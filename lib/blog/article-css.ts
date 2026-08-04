/**
 * The article typography grove ships to CUSTOMER sites.
 *
 * Why this exists: `public/embed.js` injected the article body bare —
 *
 *     cover + (a.html || '')
 *
 * — with no wrapper class and no typography rules at all. The embed's injected
 * stylesheet covers cards, chips and the article title, but nothing for `h2`,
 * `p`, `ul`, `blockquote`, `table` or `img` inside the body. On a host site with
 * a CSS reset (Tailwind's preflight, typically) headings lose their size and
 * lists lose their markers, so the same article that reads well on grove's own
 * blog arrives at the customer's site looking unstyled.
 *
 * The workaround, until now, was for each customer to reimplement grove's
 * typography by hand — ovenai maintains a partial `.grove-prose` fork that is
 * missing the measure cap, the lead paragraph, the marker colors and the image
 * captions. Asking every customer to rebuild this is the wrong shape: grove
 * writes the article, so grove should ship how it looks.
 *
 * SELF-CONTAINED ON PURPOSE. Everything resolves against a local custom
 * property with a literal fallback, so these rules work on a page that knows
 * nothing about grove's palette — while still letting a host (or embed.js)
 * theme them by setting `--ga-accent` on the wrapper.
 *
 * SPECIFICITY IS THE POINT. Every rule is `.grove-article <element>` (0,1,1),
 * which outranks the bare element selectors (0,0,1) that resets use, in any
 * load order. That is what makes this survive on a site we don't control.
 *
 * Kept in step with the `.prose` block in app/globals.css — grove's own hosted
 * blog — by tests/article-css.test.ts, which fails if one grows a rule the
 * other lacks.
 */

export const ARTICLE_CLASS = 'grove-article';

export const ARTICLE_CSS = `
.${ARTICLE_CLASS} {
  /* Every token chains through the --gv-* property embed.js measured off the
     HOST PAGE before falling back to grove's own palette. That chain is what
     makes an embedded article read as part of the customer's site instead of a
     grove-colored panel dropped into it: on a page with plum ink and a sand
     background, --ga-ink resolves to their plum, not this literal green.
     The literals still carry a consumer that renders grove content on its own
     (ovenai's server-rendered /blog/[slug]) with no --gv-* in scope. */
  --ga-ink: var(--gv-ink, #1a2e1f);
  /* Follows the accent embed.js extracted from the customer's own homepage
     (set as --gv-accent on the mount root, an ancestor of this element), and
     falls back to grove's moss when there isn't one. A non-embed consumer can
     override --ga-accent inline on the wrapper, which beats this class rule. */
  --ga-accent: var(--gv-accent, #4e9e6a);
  --ga-clay: var(--gv-muted, #6b7280);
  --ga-line: var(--gv-line, #e6e2d6);
  --ga-paper: var(--gv-raise, #f5f3ed);
  --ga-bone: var(--gv-surface, #f7f6f1);
  /* Code blocks invert against the page rather than against grove's ink, so a
     dark host site doesn't get a glaring light slab mid-article. */
  --ga-code-bg: var(--gv-code-bg, #1a2e1f);
  --ga-code-ink: var(--gv-code-ink, #f7f6f1);
  color: var(--ga-ink);
  font-size: 17px;
  line-height: 1.78;
  max-width: 68ch;
  margin: 0 auto;
  text-align: left;
}
/* The measure cap belongs to the TEXT COLUMN, and the wrapper is only the text
   column in one of the two shapes. When the article arrives from the embed API
   the wrapper also contains the 240px TOC rail, so capping it there capped the
   whole two-column grid: measured on a 1060px shell, the rail stayed 240px and
   the body was squeezed to 444px — narrower than it would have been with no
   sidebar at all. The cap moves to .grv-body in that shape, where it means what
   it says. Both rules are needed: grove's own page drops the html straight into
   the wrapper with no .grv-root, and keeps the cap above. */
.${ARTICLE_CLASS}:has(.grv-root) { max-width: none; }
.${ARTICLE_CLASS} .grv-body { max-width: 68ch; margin: 0 auto; }
/* Direct-child rules have to account for BOTH shapes the article arrives in.
   Grove's own page drops the HTML straight into the wrapper, so a direct-child
   selector matches. The embed API wraps it three levels deep —
       .grove-article > .grv-root > .grv-wrap > .grv-body > p
   — to hang its floated TOC and CTA off the same tree. Matching only the
   direct child made the lead paragraph and the block rhythm inert in exactly
   the context this stylesheet exists for; measured on a live oveners.com
   article, the lead rendered at 17px instead of 1.18em. */
.${ARTICLE_CLASS} > * + *,
.${ARTICLE_CLASS} .grv-body > * + * { margin-top: 1.1em; }

.${ARTICLE_CLASS} h1,
.${ARTICLE_CLASS} h2,
.${ARTICLE_CLASS} h3,
.${ARTICLE_CLASS} h4 {
  /* A site's heading face is usually not its body face, and plain inherit
     only ever got us the body one. --gv-head-font is sampled from the host
     page's own h1/h2/h3. */
  font-family: var(--gv-head-font, inherit);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  margin-top: 2em;
  margin-bottom: 0.6em;
  color: var(--ga-ink);
}
.${ARTICLE_CLASS} h1 { font-size: 2.2em; }
.${ARTICLE_CLASS} h2 {
  font-size: 1.55em;
  padding-bottom: 0.35em;
  border-bottom: 1px solid var(--ga-line);
  position: relative;
}
.${ARTICLE_CLASS} h2::before {
  content: '';
  display: block;
  width: 32px;
  height: 2px;
  background: var(--ga-accent);
  margin-bottom: 14px;
  border-radius: 2px;
}
.${ARTICLE_CLASS} h3 { font-size: 1.22em; }
.${ARTICLE_CLASS} h4 {
  font-size: 1.05em;
  color: var(--ga-accent);
  font-family: var(--gv-label-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.${ARTICLE_CLASS} p { margin: 0 0 1em; }
.${ARTICLE_CLASS} > p:first-of-type,
.${ARTICLE_CLASS} .grv-body > p:first-of-type {
  font-size: 1.18em;
  line-height: 1.65;
  margin-bottom: 1.4em;
}
.${ARTICLE_CLASS} > p > em:only-child,
.${ARTICLE_CLASS} .grv-body > p > em:only-child { font-size: 1.05em; color: var(--ga-clay); }

.${ARTICLE_CLASS} a {
  color: var(--ga-ink);
  text-decoration: none;
  border-bottom: 1px solid rgba(26, 46, 31, 0.16);
  /* Second declaration wins wherever color-mix is supported, tying the
     underline to the page's ink; the rgba above stays for everyone else. */
  border-bottom-color: color-mix(in srgb, var(--ga-ink) 22%, transparent);
  transition: color 0.15s ease, border-color 0.15s ease;
}
.${ARTICLE_CLASS} a:hover { color: var(--ga-accent); border-bottom-color: var(--ga-accent); }

.${ARTICLE_CLASS} strong { font-weight: 600; color: var(--ga-ink); }
.${ARTICLE_CLASS} em { color: var(--ga-clay); }

.${ARTICLE_CLASS} ul,
.${ARTICLE_CLASS} ol { margin: 0.8em 0 1.2em; }
.${ARTICLE_CLASS} ul { list-style: disc; padding-left: 1.6em; }
.${ARTICLE_CLASS} li { margin: 0.5em 0; padding-left: 6px; display: list-item; }
.${ARTICLE_CLASS} li::marker { color: var(--ga-accent); }

/* Numbered steps as accent badges, matching grove's own blog (the .prose block
   in app/globals.css). An ordered list deliberately does NOT restore
   list-style: the counter draws the numeral, so the marker box stays off.

   The badge follows --ga-accent like everything else here, which means it
   arrives in the customer's own colour rather than grove's green — a fixed
   swatch is the one thing this file must never ship. Sized in em off its own
   font-size so it scales with whatever body size the host page imposes. */
.${ARTICLE_CLASS} ol { list-style: none; counter-reset: gaol; padding-left: 0; }
.${ARTICLE_CLASS} ol > li { counter-increment: gaol; position: relative; padding-left: 2.6em; margin: 0.7em 0; }
.${ARTICLE_CLASS} ol > li::before {
  content: counter(gaol);
  position: absolute; left: 0; top: 0.1em;
  font-size: 0.76em; width: 2.15em; height: 2.15em; border-radius: 0.7em;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--gv-label-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-weight: 700;
  color: var(--ga-accent);
  /* Second declaration wins wherever color-mix is supported, tinting the badge
     with the page's own accent; the rgba stays for everyone else. */
  background: rgba(78, 158, 106, 0.12);
  background: color-mix(in srgb, var(--ga-accent) 12%, transparent);
  border: 1px solid rgba(78, 158, 106, 0.28);
  border-color: color-mix(in srgb, var(--ga-accent) 28%, transparent);
}
.${ARTICLE_CLASS} ol > li::marker { content: none; }
/* Markdown wraps loose list items in <p>; without this the badge sits against
   a paragraph's own top margin and drifts off its first line. */
.${ARTICLE_CLASS} ol > li > p { margin: 0 0 0.6em; }
.${ARTICLE_CLASS} ol > li > p:last-child { margin-bottom: 0; }

.${ARTICLE_CLASS} blockquote {
  margin: 2em 0;
  padding: 18px 24px 18px 28px;
  border-left: 3px solid var(--ga-accent);
  background: var(--ga-paper);
  font-style: italic;
  font-size: 1.35em;
  line-height: 1.45;
  border-radius: 0 10px 10px 0;
}
.${ARTICLE_CLASS} blockquote p { margin: 0; }

.${ARTICLE_CLASS} code {
  background: var(--ga-paper);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  color: var(--ga-ink);
}
.${ARTICLE_CLASS} pre {
  background: var(--ga-code-bg);
  color: var(--ga-code-ink);
  padding: 16px 18px;
  border-radius: 10px;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.55;
  margin: 1.2em 0;
}
.${ARTICLE_CLASS} pre code { background: transparent; padding: 0; color: inherit; font-size: inherit; }

.${ARTICLE_CLASS} hr {
  border: none;
  margin: 2.8em auto;
  width: 100%;
  height: 8px;
  background-image: radial-gradient(circle, var(--ga-clay) 1.5px, transparent 1.5px);
  background-size: 14px 8px;
  background-repeat: repeat-x;
  background-position: center;
}

.${ARTICLE_CLASS} img {
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  margin: 1.8em 0;
  display: block;
}
.${ARTICLE_CLASS} img + em {
  display: block;
  text-align: center;
  font-size: 13px;
  color: var(--ga-clay);
  margin-top: -1em;
  font-style: normal;
}

.${ARTICLE_CLASS} table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.6em 0;
  font-size: 15px;
  border: 1px solid var(--ga-line);
  border-radius: 8px;
  overflow: hidden;
  display: table;
}
.${ARTICLE_CLASS} table th,
.${ARTICLE_CLASS} table td {
  padding: 12px 14px;
  text-align: left;
  border-bottom: 1px solid var(--ga-line);
}
.${ARTICLE_CLASS} table th {
  background: var(--ga-paper);
  color: var(--ga-accent);
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.${ARTICLE_CLASS} table tr:last-child td { border-bottom: none; }
.${ARTICLE_CLASS} table tr:nth-child(even) td {
  background: rgba(245, 243, 237, 0.4);
  background: color-mix(in srgb, var(--ga-paper) 55%, transparent);
}

@media (max-width: 640px) {
  .${ARTICLE_CLASS} { font-size: 16px; }
  .${ARTICLE_CLASS} h2 { font-size: 1.4em; }
  .${ARTICLE_CLASS} blockquote { font-size: 1.15em; padding: 14px 18px; }
}
`.trim();
