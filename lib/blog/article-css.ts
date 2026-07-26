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
  --ga-ink: #1a2e1f;
  /* Follows the accent embed.js extracted from the customer's own homepage
     (set as --gv-accent on the mount root, an ancestor of this element), and
     falls back to grove's moss when there isn't one. A non-embed consumer can
     override --ga-accent inline on the wrapper, which beats this class rule. */
  --ga-accent: var(--gv-accent, #4e9e6a);
  --ga-clay: #6b7280;
  --ga-line: #e6e2d6;
  --ga-paper: #f5f3ed;
  --ga-bone: #f7f6f1;
  color: var(--ga-ink);
  font-size: 17px;
  line-height: 1.78;
  max-width: 68ch;
  margin: 0 auto;
  text-align: left;
}
.${ARTICLE_CLASS} > * + * { margin-top: 1.1em; }

.${ARTICLE_CLASS} h1,
.${ARTICLE_CLASS} h2,
.${ARTICLE_CLASS} h3,
.${ARTICLE_CLASS} h4 {
  font-family: inherit;
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
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.${ARTICLE_CLASS} p { margin: 0 0 1em; }
.${ARTICLE_CLASS} > p:first-of-type {
  font-size: 1.18em;
  line-height: 1.65;
  margin-bottom: 1.4em;
}
.${ARTICLE_CLASS} > p > em:only-child { font-size: 1.05em; color: var(--ga-clay); }

.${ARTICLE_CLASS} a {
  color: var(--ga-ink);
  text-decoration: none;
  border-bottom: 1px solid rgba(26, 46, 31, 0.16);
  transition: color 0.15s ease, border-color 0.15s ease;
}
.${ARTICLE_CLASS} a:hover { color: var(--ga-accent); border-bottom-color: var(--ga-accent); }

.${ARTICLE_CLASS} strong { font-weight: 600; color: var(--ga-ink); }
.${ARTICLE_CLASS} em { color: var(--ga-clay); }

.${ARTICLE_CLASS} ul,
.${ARTICLE_CLASS} ol { margin: 0.8em 0 1.2em; padding-left: 1.6em; }
.${ARTICLE_CLASS} ul { list-style: disc; }
.${ARTICLE_CLASS} ol { list-style: decimal; }
.${ARTICLE_CLASS} li { margin: 0.5em 0; padding-left: 6px; display: list-item; }
.${ARTICLE_CLASS} li::marker { color: var(--ga-accent); }

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
  background: var(--ga-ink);
  color: var(--ga-bone);
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
.${ARTICLE_CLASS} table tr:nth-child(even) td { background: rgba(245, 243, 237, 0.4); }

@media (max-width: 640px) {
  .${ARTICLE_CLASS} { font-size: 16px; }
  .${ARTICLE_CLASS} h2 { font-size: 1.4em; }
  .${ARTICLE_CLASS} blockquote { font-size: 1.15em; padding: 14px 18px; }
}
`.trim();
