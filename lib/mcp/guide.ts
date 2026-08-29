/**
 * The integration guide the `integration_guide` tool hands the customer's agent.
 *
 * A thick-blog customer is taking over rendering, which means they are also
 * taking over two things grove used to do for them and will silently stop doing:
 * firing the analytics beacon, and owning the canonical URL. Both are invisible
 * when you get them wrong — the site looks perfect, the dashboard goes quiet and
 * the monthly strategy loop starts planning against no data. So the guide leads
 * with them rather than with the pleasant part.
 *
 * Pure string building, no DB — the caller passes what it knows.
 */

export const STACKS = ['next-mdx', 'next', 'astro', 'sanity', 'wordpress', 'generic'] as const;
export type Stack = (typeof STACKS)[number];

export function normalizeStack(v: unknown): Stack {
  const s = String(v ?? '').toLowerCase().replace(/[\s_]+/g, '-');
  if (s.includes('mdx')) return 'next-mdx';
  if (s.includes('next')) return 'next';
  if (s.includes('astro')) return 'astro';
  if (s.includes('sanity')) return 'sanity';
  if (s.includes('wordpress') || s.includes('wp')) return 'wordpress';
  return 'generic';
}

/** The beacon, as a paste-ready module. Mirrors public/embed.js `track()`. */
function beaconSnippet(appBase: string): string {
  return `\`\`\`js
// grove-beacon.js — call once per article page, client side.
// Returns a teardown fn; call it on unmount so SPA navigation doesn't leak.
export function groveBeacon({ postId, domainId, endpoint = '${appBase}/api/track' }) {
  if (!postId || !domainId || typeof window === 'undefined') return () => {};
  let sid;
  try { sid = sessionStorage.getItem('gv_sid'); } catch {}
  if (!sid) {
    sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('gv_sid', sid); } catch {}
  }
  const post = (extra) => {
    const body = JSON.stringify({
      post_id: postId, domain_id: domainId, session_id: sid,
      referrer: document.referrer || undefined, ...extra,
    });
    // sendBeacon survives the page unloading; fetch is the fallback.
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    else fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  post({ type: 'view' });
  const start = Date.now(), seen = {};
  const onScroll = () => {
    const h = document.documentElement;
    const pct = ((h.scrollTop + h.clientHeight) / (h.scrollHeight || 1)) * 100;
    for (const d of [25, 50, 75, 100]) if (pct >= d && !seen[d]) { seen[d] = 1; post({ type: 'scroll', scroll_depth: d }); }
  };
  const onExit = () => post({ type: 'exit', dwell_ms: Date.now() - start });
  const onClick = (e) => {
    const a = e.target.closest?.('a[data-conv]');
    if (a) post({ type: 'conversion', outbound_url: a.href });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', onExit);
  document.addEventListener('click', onClick);
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', onExit);
    document.removeEventListener('click', onClick);
  };
}
\`\`\``;
}

const STACK_NOTES: Record<Stack, string> = {
  'next-mdx': [
    '### This stack (Next.js + MDX files)',
    '',
    '- Ask for `format: "mdx"`. It escapes `{` and a bare `<` outside code fences; markdown renderers tolerate those, the MDX compiler does not, and a failed build is a worse outcome than a missing import.',
    '- Write to wherever the existing posts live (`content/blog/*.mdx` or similar) and copy the frontmatter keys already used there — pass `field_map` rather than hand-editing each file.',
    '- The beacon is a client component: `\'use client\'`, `useEffect(() => groveBeacon({ postId, domainId }), [])`, with the ids read from the frontmatter you imported.',
    '- Cover images: grove serves them from its own CDN and they are stable. Download them into the repo only if that is what the existing posts do.',
  ].join('\n'),
  next: [
    '### This stack (Next.js)',
    '',
    '- Ask for `format: "html"` if the page renders stored HTML, `"md"` if it renders markdown through the existing pipeline.',
    '- Fire the beacon from a client component mounted by the article page.',
    '- If articles are server-rendered from a database, do the import as a script against the DB, not as a request-time fetch to grove — the content should live in this system.',
  ].join('\n'),
  astro: [
    '### This stack (Astro)',
    '',
    '- Ask for `format: "md"` (or `"mdx"` for `.mdx` collections) and match the content-collection schema in `src/content/config.ts` with `field_map` — an unmapped key fails Astro\'s schema validation at build time.',
    '- The beacon needs `client:load` on the component that calls it.',
  ].join('\n'),
  sanity: [
    '### This stack (Sanity)',
    '',
    '- Ask for `format: "json"` with `frontmatter: "none"`, then map fields onto the document type in the import script.',
    '- Keep `grove_id` on the document. It is the join key that makes a re-import an update rather than a duplicate, and slugs can be edited on your side.',
    '- Markdown must be converted to whatever the schema stores (Portable Text or a markdown field). Do not paste raw markdown into a Portable Text array.',
  ].join('\n'),
  wordpress: [
    '### This stack (WordPress)',
    '',
    '- Ask for `format: "html"` with `frontmatter: "none"` and POST the body to `wp/v2/posts` as `content`; put the meta description into the SEO plugin\'s field, not the excerpt, if one is installed.',
    '- Store `grove_id` as post meta so a re-import updates the same post.',
    '- The beacon goes in the theme\'s article template, guarded to single-post views.',
  ].join('\n'),
  generic: [
    '### This stack',
    '',
    '- Pick the format that matches how the layer stores article bodies: `md`/`mdx` for files, `html` for rendered storage, `json` for an import script.',
    '- Keep `grove_id` somewhere queryable so a re-import updates instead of duplicating.',
    '- Follow the conventions of the content already here — existing frontmatter keys, image handling, routing. `field_map` renames grove\'s keys so you do not have to touch each file.',
  ].join('\n'),
};

export function integrationGuide(opts: {
  stack?: unknown;
  appBase: string;
  /** The customer's hostname, when the key resolves to exactly one site. */
  hostname?: string | null;
  /** Where grove currently points canonicals, if anywhere. */
  canonicalBase?: string | null;
}): string {
  const stack = normalizeStack(opts.stack);
  const site = opts.hostname ?? 'your site';
  const canonical = opts.canonicalBase;

  return [
    `# Putting grove articles into ${site}'s own content layer`,
    '',
    'Grove has already researched, written and quality-gated these articles. Your job is to place them',
    'in the layer this codebase already has — not to rewrite them, and not to build a second blog',
    'beside the existing one.',
    '',
    '## The loop',
    '',
    '```',
    'list_sites            → which site, and what is already delivered',
    'pull_new              → the articles not yet imported, formatted for you',
    '  ↳ write each into the existing layer',
    'record_delivery       → the live URL, per article  ← do not skip this',
    'set_canonical_base    → once, when the URL pattern is settled',
    '```',
    '',
    '`record_delivery` is what makes `pull_new` incremental. Skip it and the next run hands you the',
    'same articles again, and the customer\'s dashboard still shows the content as unpublished.',
    '',
    '## Two things that break silently',
    '',
    '**1. The analytics beacon.** Grove\'s reporting — reads, engagement, traffic sources — and the',
    'monthly strategy loop that chooses next month\'s topics both run on a first-party event stream.',
    'When grove renders the article it fires those events itself. Once you render it, nothing does,',
    'unless the page below does. No cookies, no third-party JS, no fingerprinting; the session id is',
    'per-tab. `post_id` and `domain_id` come back with every article — keep them on the page.',
    '',
    beaconSnippet(opts.appBase),
    '',
    '**2. Canonical URLs.** Two copies of an article exist the moment you import one: yours and',
    'grove\'s mirror. Whichever is canonical is the one search engines credit.',
    canonical
      ? `Canonicals for this site already point at \`${canonical}\`, so the articles you publish under that base are the canonical copies. Nothing more to do.`
      : 'Call `set_canonical_base` with the base your articles are served under once the pattern is settled. Grove then rewrites rel=canonical, the sitemap, RSS, JSON-LD and social links to point at your pages, and keeps its own copy as a non-canonical mirror. Until you do, the credit accrues to grove\'s domain.',
    '',
    '## Frontmatter fields',
    '',
    '| key | meaning |',
    '| --- | --- |',
    '| `title` | The article title. Already stripped from the body — render it from this field or it prints twice. |',
    '| `description` | Meta description, written for search. Use it for `<meta name="description">`, not as a teaser you rewrite. |',
    '| `slug` | Grove\'s slug. Keep it if you can: it is what every already-emitted grove URL points at. |',
    '| `date` / `updated` | First publication and last in-place rewrite. `updated` is null unless the article was refreshed. |',
    '| `author` | The site\'s founder name, or "{Business} Team". Never "AI" — do not relabel it. |',
    '| `genre` | Reader-facing category (Guide, Comparison, …). Map it onto the existing taxonomy. |',
    '| `cover` / `cover_credit` | Cover image URL and its attribution. Render the credit if the image has one. |',
    '| `canonical` | Where grove currently considers this article canonical. |',
    '| `grove_id` | Grove\'s post id. Keep it — it is how a re-import updates instead of duplicating, and what `record_delivery` and `post_analytics` accept. |',
    '',
    STACK_NOTES[stack],
    '',
    '## Do not',
    '',
    '- Rewrite the body. It passed a scored editorial gate; an edited version has not, and the',
    '  dashboard will report on an article that no longer exists.',
    '- Import drafts. `list_posts` can show `review` status, but only `published` articles are final.',
    '- Drop `grove_id`, `post_id` or `domain_id` on the way in. Everything downstream — sync,',
    '  analytics, reporting — is keyed on them.',
  ].join('\n');
}
