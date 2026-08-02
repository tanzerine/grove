/* grove embed.js — zero-config blog for your own site.
   Auto-detects your domain AND your design; no slug, no API key, no CSS.

   The blog section is meant to look like the rest of your page built it. It
   reads the computed styles of the page it's mounted in — body and heading
   fonts, text color, background, border strength, corner radius — and derives
   every surface from those. Drop the div into a page that already has your nav
   and your styles, and the cards, chips, and article body come out in your
   type and your palette. A dark page is detected as dark on its own.

   Nothing to configure for that; the options below are all overrides.

   Pick a mount point:

   1) Widget (teaser on a landing/home page — newest 3–4 posts + link to blog):
        <div id="grove-widget" data-blog-url="/blog"></div>
        <script src="https://grove.so/embed.js" async></script>

   2) Full blog (the whole front end — featured card, search, genre filters,
      pagination, and in-page article reading):
        <div id="grove-blog"></div>
        <script src="https://grove.so/embed.js" async></script>

   3) Legacy simple list (back-compat):
        <div id="grove-feed"></div>

   Options (data-attributes on the mount div):
     data-count      widget only — how many posts (default 4)
     data-blog-url   widget only — where "Read the blog →" + cards link (default /blog)
     data-accent     accent color. Default: the brand color grove extracted from
                     your homepage (returned by the API), else #4e9e6a. The
                     default is contrast-corrected against your page background
                     so it stays legible; a value you set here is used as-is.
     data-theme      dark | light | auto (follows prefers-color-scheme).
                     Omit it: surfaces are taken from your page, so a dark site
                     comes out dark without being told. Set it only to override
                     what the page says. Fonts and radius are inherited either
                     way — those aren't theme decisions.

   To restyle beyond that, set any --gv-* property on the mount div; an
   author-set value beats everything measured. Useful ones: --gv-surface,
   --gv-ink, --gv-line, --gv-muted, --gv-radius, --gv-head-font,
   --gv-label-font.
     data-host       pin the domain to look up instead of auto-detecting
                     window.location.hostname. Use it on staging/preview URLs
                     and localhost, where the live hostname isn't the one that
                     owns the blog.
*/
(function () {
  var ORIGIN =
    (document.currentScript && document.currentScript.src && new URL(document.currentScript.src).origin) ||
    'https://grove-red.vercel.app';

  function api(host, path) {
    return ORIGIN + '/api/embed/host/' + encodeURIComponent(host) + (path || '');
  }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ── first-party analytics: same view/dwell/scroll/conversion beacon the
     grove-hosted reader sends, so embed-rendered articles also feed the
     dashboard. No cookies, no fingerprinting; session id is per-tab. Returns a
     teardown fn so SPA hash navigation doesn't leak listeners/timers. ── */
  var _trackTeardown = null;
  function track(postId, domainId, root) {
    if (_trackTeardown) { _trackTeardown(); _trackTeardown = null; }
    if (!postId || !domainId) return;
    var ep = ORIGIN + '/api/track';
    var sid;
    try { sid = sessionStorage.getItem('gv_sid'); } catch (e) {}
    if (!sid) { sid = Math.random().toString(36).slice(2) + Date.now().toString(36); try { sessionStorage.setItem('gv_sid', sid); } catch (e) {} }
    var utm = {};
    try { var q = new URLSearchParams(location.search); ['source', 'medium', 'campaign'].forEach(function (k) { var v = q.get('utm_' + k); if (v) utm['utm_' + k] = v; }); } catch (e) {}
    function post(extra) {
      var b = {}; for (var k in utm) b[k] = utm[k];
      b.post_id = postId; b.domain_id = domainId; b.session_id = sid; b.referrer = document.referrer || undefined;
      for (var k2 in extra) b[k2] = extra[k2];
      var body = JSON.stringify(b);
      try { if (navigator.sendBeacon) { navigator.sendBeacon(ep, new Blob([body], { type: 'application/json' })); return; } } catch (e) {}
      try { fetch(ep, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
    }
    post({ type: 'view' });
    var start = Date.now(), sent = {};
    var di = setInterval(function () { post({ type: 'dwell', dwell_ms: Date.now() - start }); }, 15000);
    function onScroll() {
      var h = document.documentElement;
      var max = (h.scrollTop + h.clientHeight) / (h.scrollHeight || 1) * 100;
      [25, 50, 75, 100].forEach(function (d) { if (max >= d && !sent[d]) { sent[d] = 1; post({ type: 'scroll', scroll_depth: d }); } });
    }
    function onClick(e) {
      var t = e.target.closest ? e.target.closest('a') : null;
      if (t && t.hasAttribute('data-conv')) post({ type: 'conversion', outbound_url: t.href });
    }
    function onExit() { post({ type: 'exit', dwell_ms: Date.now() - start }); }
    window.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('click', onClick);
    window.addEventListener('pagehide', onExit);
    _trackTeardown = function () {
      clearInterval(di);
      window.removeEventListener('scroll', onScroll);
      root.removeEventListener('click', onClick);
      window.removeEventListener('pagehide', onExit);
    };
    return _trackTeardown;
  }
  function fmtDate(d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return String(d).slice(0, 10); }
  }
  // Deterministic soft cover for posts without an image.
  var BGS = ['#E6F0FF', '#EAE3FF', '#FFE4EC', '#FFF4DC', '#DCEEFF', '#E8F0FF'];
  function bgFor(s) { var h = 0, i; for (i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return BGS[h % BGS.length]; }
  function initial(t) { return ((t || '◆').trim()[0] || '◆').toUpperCase(); }

  /* Article typography, served by grove at /article.css.
     The embed used to inject the article body bare — no wrapper, no rules for
     h2/p/ul/blockquote/table — so on any host with a CSS reset (Tailwind's
     preflight, typically) headings lost their size and lists lost their
     markers. Linking grove's own stylesheet means the customer doesn't have to
     reimplement it, and an update reaches every embed at once. */
  var ARTICLE_LINK_ID = 'grove-article-css';
  function injectArticleCss() {
    if (document.getElementById(ARTICLE_LINK_ID)) return;
    var l = document.createElement('link');
    l.id = ARTICLE_LINK_ID;
    l.rel = 'stylesheet';
    l.href = ORIGIN + '/article.css';
    document.head.appendChild(l);
  }

  /* Every surface color resolves through a custom property, so a host page can
     drop the embed onto a dark background without forking this file:
     data-theme="dark" (or "auto") is the whole configuration. The article
     stylesheet is themed through the same switch — its --ga-* properties are
     declared on .grove-article, which lives inside the mount root. */
  var DARK_VARS = '--gv-surface:#111110;--gv-line:rgba(255,255,255,0.13);--gv-ink:#f4f4f2;--gv-muted:#9a9d97;--gv-on-accent:#0a0a09';
  /* Each --ga-* chains through the matching --gv-* before its dark literal.
     `.gv.gv-dark .grove-article` (0,3,0) out-specifies the `.grove-article`
     (0,1,0) rule in article.css, so without the chain a measured dark page
     would have its real colors overwritten by these generic ones — the mount
     goes dark, then throws away the palette it just measured. */
  var DARK_ARTICLE = '--ga-ink:var(--gv-ink,#f4f4f2);--ga-clay:var(--gv-muted,#9a9d97);--ga-line:var(--gv-line,rgba(255,255,255,0.13));--ga-paper:var(--gv-raise,#151614);--ga-bone:var(--gv-surface,#151614);--ga-code-bg:var(--gv-code-bg,#0c0d0b);--ga-code-ink:var(--gv-code-ink,#f4f4f2)';

  /* Theme is per-mount (one page can hold a light widget and a dark blog), so
     it rides on the root's class rather than the shared stylesheet. */
  function themeClass(root) {
    var t = (root.getAttribute('data-theme') || '').toLowerCase();
    return t === 'dark' ? ' gv-dark' : t === 'auto' ? ' gv-auto' : '';
  }

  /* ─────────────────────── design inheritance ───────────────────────────────
     The whole point of the embed is that the blog section looks like it was
     built by whoever built the page around it. Until now it wasn't: the
     stylesheet hardcoded grove's own palette (#fff cards, #1a2e1f green ink,
     #f5f3ed paper) and set `ui-monospace` on every label, so a customer who
     pasted the div onto a serif, sand-colored page got white cards, green body
     text and mono chrome — three things their design system never chose.

     The fix is to stop guessing. The embed renders INSIDE the customer's page,
     which makes the page itself the most accurate possible source of truth —
     better than a crawl (which sees markup, not what the browser computed) and
     better than configuration (which the customer has to maintain). We read the
     host document's computed styles and derive the full token set from them.

     Split into pure functions over plain values on purpose: embed.js runs on
     domains we don't control and the suite has no DOM harness, so the
     derivation is unit-tested directly (tests/embed-design.test.ts) and only
     the thin measurement layer touches the DOM. */

  function parseColor(s) {
    if (!s) return null;
    var m = String(s).match(/rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(/[,\/\s]+/).filter(function (x) { return x !== ''; }).map(parseFloat);
      if (p.length < 3 || p.slice(0, 3).some(function (n) { return isNaN(n); })) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 && !isNaN(p[3]) ? p[3] : 1 };
    }
    var h = String(s).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!h) return null;
    var v = h[1];
    if (v.length === 3) v = v[0] + v[0] + v[1] + v[1] + v[2] + v[2];
    return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 };
  }
  function rgbStr(c) { return 'rgb(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ')'; }
  function mix(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 };
  }
  function luminance(c) {
    function f(v) { var s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  var WHITE = { r: 255, g: 255, b: 255, a: 1 };
  var BLACK = { r: 0, g: 0, b: 0, a: 1 };

  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /* Nudge a color until it's legible on `bg`, moving toward whichever pole the
     background isn't. Grove derives a customer's accent to read on WHITE
     (lib/blog-theme accentForText), which is the wrong target the moment the
     embed lands on a dark page: oveners' near-black brand color is a perfectly
     good accent on their own site and completely invisible on a #0b0d10 one.
     Correcting against the measured background is what makes one extracted
     palette work on any page it's dropped into. */
  function readableOn(color, bg, min) {
    var target = luminance(bg) < 0.22 ? WHITE : BLACK;
    var c = color;
    for (var i = 0; i < 12 && contrast(c, bg) < min; i++) c = mix(c, target, 0.12);
    return c;
  }

  /* The card fill — lifted off the page, but never at the cost of the text on
     it.

     Lifting a dark page toward white by 7% is free when the page is genuinely
     dark: near-white ink on #0a0b10 reads at 16:1, and the lift costs about two
     points of that. It is NOT free on a mid-tone. A #6f7278 page with near-white
     ink only has 4.3:1 to begin with, and the same lift spends enough of it to
     drop grove's cards to 3.7:1 — below AA, and visibly worse than the very same
     text sitting on the page around it.

     So the lift is capped by the page's own readability: grove's card may never
     be harder to read than the host's own background. Where that leaves no room,
     the card sits flush and --gv-line does the separating, which is what the
     host's own cards are doing on such a page anyway. */
  function cardSurface(bg, ink, dark) {
    if (!dark) return mix(bg, WHITE, 0.55);
    var floor = Math.min(4.5, contrast(ink, bg));
    for (var t = 0.07; t > 0; t -= 0.01) {
      var s = mix(bg, WHITE, t);
      if (contrast(ink, s) >= floor) return s;
    }
    return bg;
  }

  /* Measured page values → the custom properties every embed surface reads.
     Returns a plain {prop: value} map; the caller writes it onto the mount.

     Colors are derived as RELATIONSHIPS to the page's own paper and ink rather
     than as fixed values, which is what makes one formula work on a white
     marketing site, a sand-colored one and a near-black one alike:
       surface  cards lift off the page (toward white on light, toward light on dark)
       line     ink at ~14% — the border strength most design systems land on
       muted    ink at ~55% — secondary text
       raise    ink at ~6% — blockquote / code / table-header fills
     `dark` is reported so the caller can also switch the placeholder-cover
     rules, which are class-based rather than token-based. */
  function deriveTokens(m) {
    var out = {};
    if (m.bodyFont) out['--gv-label-font'] = m.bodyFont;
    if (m.headFont || m.bodyFont) out['--gv-head-font'] = m.headFont || m.bodyFont;
    if (m.radius != null && !isNaN(m.radius)) {
      var rad = Math.max(0, Math.min(28, m.radius));
      out['--gv-radius'] = rad + 'px';
      // Chips and badges are pills by default, but a system that corners its
      // cards at 4px is a squared-off system and 999px pills read as imported
      // from somewhere else. Follow the page when it's squared; keep the pill
      // when it's soft — where a pill is the idiom anyway.
      out['--gv-pill'] = rad <= 8 ? rad + 'px' : '999px';
    }

    var bg = parseColor(m.bg);
    var ink = parseColor(m.ink);
    // Without both anchors a derived palette is a guess; leave the stylesheet
    // defaults (or an explicit data-theme) in charge rather than inventing one.
    if (!bg || !ink) return { vars: out, dark: false, themed: false };

    var dark = luminance(bg) < 0.22;
    out['--gv-bg'] = rgbStr(bg);
    out['--gv-ink'] = rgbStr(ink);
    out['--gv-surface'] = rgbStr(cardSurface(bg, ink, dark));
    out['--gv-line'] = rgbStr(mix(bg, ink, 0.14));
    out['--gv-muted'] = rgbStr(mix(bg, ink, 0.55));
    out['--gv-raise'] = rgbStr(mix(bg, ink, 0.06));
    // Card hover lift. On a light page, tint by the page's own ink so the
    // shadow belongs to the site rather than to grove's green-black. On a dark
    // one it has to stay black regardless — an ink-tinted shadow there is
    // near-white, which glows instead of lifting.
    out['--gv-shadow'] = dark
      ? 'rgba(0,0,0,0.55)'
      : 'rgba(' + [ink.r, ink.g, ink.b].map(Math.round).join(',') + ',0.22)';
    // Code blocks invert on a light page and lift on a dark one — the reverse
    // of either is the "slab of the wrong color" that reads as someone else's
    // stylesheet leaking in.
    out['--gv-code-bg'] = dark ? rgbStr(mix(bg, WHITE, 0.1)) : rgbStr(mix(ink, BLACK, 0.15));
    out['--gv-code-ink'] = dark ? rgbStr(ink) : rgbStr(mix(bg, WHITE, 0.85));

    var accent = parseColor(m.accent);
    if (accent) {
      // 4.5:1, not the 3.2 UI-component floor this used to take. The accent is
      // not only a border and a fill here — .gv-kicker is 11px, .gv-badge 10px,
      // .gv-link 12px. None of those are "large text", so 3.2 was the wrong
      // floor for the thing this color mostly does.
      var acc = readableOn(accent, bg, 4.5);
      // An accent the customer pinned with data-accent is a stated intent, not
      // a guess: report the corrected value for contrast math but never
      // overwrite theirs.
      if (!m.accentPinned) out['--gv-accent'] = rgbStr(acc);
      // Text sitting ON the accent fill (the active chip, the ★ Featured
      // badge). Decided by contrast against the fill itself, not by the page's
      // ink: a dark site has near-white ink, and pairing that with a bright
      // cyan accent is light-on-light. The dark candidate is the accent driven
      // most of the way to black, so the pairing stays in the brand's family.
      var deep = mix(acc, BLACK, 0.82);
      out['--gv-on-accent'] = contrast(deep, acc) >= contrast(WHITE, acc) ? rgbStr(deep) : '#fff';
    }
    return { vars: out, dark: dark, themed: true };
  }

  /* Read what the browser actually computed for the page around the mount.
     Anchored on the mount's PARENT, never the mount itself: `.gv` sets
     `color:var(--gv-ink)`, so measuring the root once it carries that class
     would read grove's own green back out and cheerfully "inherit" it. The
     parent is the customer's container and nothing grove ships can touch it —
     which also keeps this correct on every re-render, not just the first.
     Elements inside the mount are skipped for the same reason. */
  function measurePage(root, win, doc) {
    var anchor = root.parentElement || doc.body;
    if (!anchor) return {};
    var cs = win.getComputedStyle(anchor);
    return {
      bg: paintedBg(anchor, win, doc),
      ink: cs.color,
      bodyFont: cs.fontFamily,
      headFont: sampleFont(root, win, doc, 'h1,h2,h3,h4'),
      // Whatever actually won for the accent — data-accent, the palette the API
      // extracted from the customer's homepage, or the stylesheet default. Read
      // back off the root so --gv-on-accent is contrast-checked against the
      // real color rather than an assumed one.
      accent: win.getComputedStyle(root).getPropertyValue('--gv-accent'),
      accentPinned: !!root.getAttribute('data-accent'),
      radius: sampleRadius(root, win, doc),
    };
  }

  /* A page's background is usually painted on <body> or <html>, not on the
     element the customer dropped the div into — and an unpainted ancestor
     computes to transparent, which would read as black. Walk up for the first
     real fill. */
  function paintedBg(el, win, doc) {
    for (var n = el; n; n = n.parentElement) {
      var c = parseColor(win.getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.9) return rgbStr(c);
    }
    return doc.body ? 'rgb(255,255,255)' : null;
  }

  function sampleFont(root, win, doc, sel) {
    var els = doc.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) {
      if (root.contains(els[i])) continue;
      var f = win.getComputedStyle(els[i]).fontFamily;
      if (f) return f;
    }
    return null;
  }

  /* Corner radius is a loud part of a design system — 4px squares next to
     grove's 14px pills look like two different products. Take the most common
     non-zero radius among the page's own buttons and cards. */
  function sampleRadius(root, win, doc) {
    // Broad on purpose: a styled <a> is as likely to be the site's button as a
    // <button> is. The real filter is below — anything without a usable radius
    // is discarded, so over-selecting costs nothing but a few reads.
    var els = doc.querySelectorAll('button,input,textarea,select,a[class],img[class],[class*="card"],[class*="btn"],[class*="button"],[class*="rounded"]');
    var counts = {}, best = null, bestN = 0;
    for (var i = 0; i < els.length && i < 60; i++) {
      if (root.contains(els[i])) continue;
      var ecs = win.getComputedStyle(els[i]);
      var r = parseFloat(ecs.borderTopLeftRadius);
      // Pills say nothing about how the page corners a card.
      if (isNaN(r) || r > 28) continue;
      // Zero is a design decision on a brutalist or terminal-styled site, and
      // skipping it there left grove's 14px cards and 999px chips rounded on a
      // page where nothing else was — the single loudest way the embed reads as
      // imported. But zero is ALSO what every unstyled <a class> computes to,
      // and letting those vote would square almost every site on the web. So a
      // zero only counts from something that is actually a painted surface.
      if (r === 0) {
        var ebg = parseColor(ecs.backgroundColor);
        if (!(ebg && ebg.a > 0.05) && !(parseFloat(ecs.borderTopWidth) > 0)) continue;
      }
      counts[r] = (counts[r] || 0) + 1;
      if (counts[r] > bestN) { bestN = counts[r]; best = r; }
    }
    return best;
  }

  /* Write the derived tokens onto the mount. Inline properties beat the
     stylesheet's class rules, so the measured page always wins over grove's
     defaults — while an explicit data-theme still wins over measurement, since
     that is the customer stating an intent the page can't express. */
  function applyDesign(root, win, doc) {
    var explicit = (root.getAttribute('data-theme') || '').toLowerCase();
    var pinned = explicit === 'dark' || explicit === 'light' || explicit === 'auto';
    // Snapshot the --gv-* properties the AUTHOR wrote on the mount, once,
    // before we write any of our own. Measurement must never overwrite those:
    // `style="--gv-surface:#fff"` is someone telling us the answer. Taken once
    // because applyDesign runs again after branding resolves, and by then our
    // own values are sitting in the same inline style. --gv-accent is excluded
    // deliberately — applyBranding writes it inline from the API, which is
    // grove's value, not the author's; data-accent is how an author pins it.
    if (!root._gvAuthored) {
      var authored = {};
      for (var i = 0; i < root.style.length; i++) {
        var prop = root.style[i];
        if (prop.indexOf('--gv-') === 0 && prop !== '--gv-accent') authored[prop] = 1;
      }
      root._gvAuthored = authored;
    }
    var d;
    try { d = deriveTokens(measurePage(root, win, doc)); }
    catch (e) { return; }
    for (var k in d.vars) {
      if (root._gvAuthored[k]) continue;
      // Typography and geometry are never a theme decision — inherit them even
      // when the customer pinned light/dark.
      if (pinned && !/font|radius|pill/.test(k)) continue;
      root.style.setProperty(k, d.vars[k]);
    }
    // Reuse the existing dark machinery (placeholder-cover tinting lives in
    // class rules, not tokens) when the page turns out to be dark on its own.
    if (!pinned && d.themed && d.dark) root.classList.add('gv-dark');
  }

  var STYLE_ID = 'grove-embed-style';
  function injectStyle(accent) {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.gv{--gv-accent:' + accent + ';--gv-surface:#fff;--gv-line:#e6e2d6;--gv-ink:#1a2e1f;--gv-muted:#7a8a7d;--gv-on-accent:#fff;color:var(--gv-ink);}',
      '.gv.gv-dark{' + DARK_VARS + '}',
      '.gv.gv-dark .grove-article{' + DARK_ARTICLE + '}',
      '@media(prefers-color-scheme:dark){.gv.gv-auto{' + DARK_VARS + '}.gv.gv-auto .grove-article{' + DARK_ARTICLE + '}}',
      '.gv *{box-sizing:border-box}',
      '.gv a{text-decoration:none;color:inherit}',
      '.gv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px}',
      // Typography follows the host page. --gv-head-font/--gv-label-font are
      // measured off the customer's own headings and body text (applyDesign);
      // `inherit` keeps the embed on the page's font even when measurement is
      // unavailable. These used to be a hardcoded `ui-monospace` on every
      // label, which is grove's design language, not the customer's.
      '.gv-h{font-size:13px;font-weight:600;font-family:var(--gv-head-font,inherit)}',
      '.gv-kicker{font-family:var(--gv-label-font,inherit);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--gv-accent);margin-bottom:6px}',
      '.gv-link{font-family:var(--gv-label-font,inherit);font-size:12px;color:var(--gv-accent)}',
      '.gv-search{width:230px;max-width:60vw;padding:9px 14px;border:1px solid var(--gv-line);border-radius:var(--gv-radius,999px);font:inherit;font-size:14px;outline:none;background:var(--gv-surface);color:var(--gv-ink)}',
      '.gv-search:focus{border-color:var(--gv-accent);box-shadow:0 0 0 3px rgba(78,158,106,.15);box-shadow:0 0 0 3px color-mix(in srgb,var(--gv-accent) 15%,transparent)}',
      '.gv-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}',
      '.gv-chip{font-family:var(--gv-label-font,inherit);font-size:12px;padding:6px 14px;border-radius:var(--gv-pill,999px);border:1px solid var(--gv-line);background:var(--gv-surface);cursor:pointer;color:var(--gv-ink)}',
      '.gv-chip:hover{border-color:var(--gv-accent);color:var(--gv-accent)}',
      '.gv-chip.on{background:var(--gv-accent);color:var(--gv-on-accent);border-color:var(--gv-accent)}',
      '.gv-badge{font-family:var(--gv-label-font,inherit);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--gv-accent);background:rgba(78,158,106,.10);background:color-mix(in srgb,var(--gv-accent) 10%,transparent);border-radius:var(--gv-pill,999px);padding:3px 9px}',
      '.gv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}',
      '.gv-card{display:flex;flex-direction:column;background:var(--gv-surface);border:1px solid var(--gv-line);border-radius:var(--gv-radius,14px);overflow:hidden;transition:transform .16s,box-shadow .16s,border-color .16s}',
      '.gv-card:hover{transform:translateY(-3px);border-color:var(--gv-accent);box-shadow:0 16px 34px -20px var(--gv-shadow,rgba(26,46,31,.28))}',
      // The no-cover placeholder tint rides on --gv-ph rather than an inline
      // background, so a theme can restyle it. On dark it is mixed down into
      // the surface — the raw pastels are painfully bright on a black page.
      '.gv-cover{height:160px;background:var(--gv-ph,#eef0ea);background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:700;color:rgba(26,46,31,.28);color:color-mix(in srgb,var(--gv-ink) 30%,transparent)}',
      '.gv.gv-dark .gv-cover,.gv.gv-dark .gv-feat-media{background-color:#1b1c19;background-color:color-mix(in srgb,var(--gv-ph) 16%,#111110);color:rgba(255,255,255,.34)}',
      '@media(prefers-color-scheme:dark){.gv.gv-auto .gv-cover,.gv.gv-auto .gv-feat-media{background-color:#1b1c19;background-color:color-mix(in srgb,var(--gv-ph) 16%,#111110);color:rgba(255,255,255,.34)}}',
      '.gv-cardbody{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}',
      '.gv-title{font-size:18px;font-weight:600;line-height:1.25;margin:10px 0 0;font-family:var(--gv-head-font,inherit)}',
      '.gv-ex{font-size:13.5px;color:var(--gv-muted);line-height:1.55;margin:8px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.gv-byline{font-family:var(--gv-label-font,inherit);font-size:11.5px;color:var(--gv-muted);margin-top:14px}',
      '.gv-feat{display:grid;grid-template-columns:1.05fr 1fr;background:var(--gv-surface);border:1px solid var(--gv-line);border-radius:var(--gv-radius,18px);overflow:hidden;margin-bottom:26px;transition:transform .16s,box-shadow .16s,border-color .16s}',
      '.gv-feat:hover{transform:translateY(-3px);border-color:var(--gv-accent);box-shadow:0 20px 48px -24px var(--gv-shadow,rgba(26,46,31,.32))}',
      '.gv-feat-media{min-height:320px;background:var(--gv-ph,#eef0ea);background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:88px;font-weight:700;color:rgba(26,46,31,.26);color:color-mix(in srgb,var(--gv-ink) 28%,transparent)}',
      '.gv-feat-body{padding:34px 36px;display:flex;flex-direction:column;justify-content:center}',
      '.gv-feat-title{font-size:30px;font-weight:700;line-height:1.12;margin:14px 0 0;font-family:var(--gv-head-font,inherit)}',
      '.gv-pager{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:40px}',
      '.gv-pg{font-family:var(--gv-label-font,inherit);font-size:13px;color:var(--gv-accent);background:var(--gv-surface);border:1px solid var(--gv-line);border-radius:var(--gv-pill,999px);padding:8px 16px;cursor:pointer}',
      '.gv-pg[disabled]{color:var(--gv-muted);opacity:.55;cursor:default}',
      '.gv-empty{padding:60px 0;text-align:center;color:var(--gv-muted);font-size:14px}',
      '.gv-back{font-family:var(--gv-label-font,inherit);font-size:12px;color:var(--gv-accent);display:inline-block;margin-bottom:18px;cursor:pointer}',
      '.gv-art-title{font-size:clamp(28px,4.2vw,44px);font-weight:700;line-height:1.15;letter-spacing:-.02em;margin:6px 0 10px;font-family:var(--gv-head-font,inherit)}',
      '.gv-art-meta{font-family:var(--gv-label-font,inherit);font-size:12px;color:var(--gv-muted);margin-bottom:22px}',
      '.gv-art-cover{width:100%;border-radius:var(--gv-radius,14px);border:1px solid var(--gv-line);margin-bottom:26px}',
      '@media(max-width:880px){.gv-grid{grid-template-columns:repeat(2,1fr)}}',
      '@media(max-width:760px){.gv-feat{grid-template-columns:1fr}.gv-feat-media{min-height:200px}}',
      '@media(max-width:560px){.gv-grid{grid-template-columns:1fr}}'
    ].join('');
    document.head.appendChild(s);
  }

  /* Brand accent from the API (extracted from the customer's homepage).
     A data-accent attribute on the mount div always wins; otherwise the
     extracted color is set as --gv-accent on the root, so cards, chips, links,
     and badges follow the site's own palette with zero configuration. */
  function applyBranding(root, branding) {
    if (root.getAttribute('data-accent')) return;
    // accent_raw is the UNCORRECTED brand color. Prefer it: applyDesign runs
    // straight after this and corrects against the page it measured, which is
    // strictly better than the API's guess that we are sitting on white. The
    // `accent` fallback keeps this working against an older deployment.
    var a = branding && (branding.accent_raw || branding.accent);
    if (a) root.style.setProperty('--gv-accent', a);
  }

  function cardHTML(p, href) {
    var cover = p.cover_image_url
      ? '<div class="gv-cover" style="background-image:url(' + esc(p.cover_image_url) + ')"></div>'
      : '<div class="gv-cover" style="--gv-ph:' + bgFor(p.slug) + '">' + esc(initial(p.title)) + '</div>';
    var foot = p.author ? esc(p.author) : ((p.read_minutes || 5) + ' min read');
    return '<a class="gv-card" href="' + esc(href) + '">' + cover +
      '<div class="gv-cardbody">' +
        '<div><span class="gv-badge">' + esc(p.genre || 'Article') + '</span></div>' +
        '<div class="gv-title">' + esc(p.title) + '</div>' +
        (p.excerpt ? '<div class="gv-ex">' + esc(p.excerpt) + '</div>' : '') +
        '<div class="gv-byline" style="margin-top:auto;padding-top:14px">' + foot +
          (p.date ? ' · ' + fmtDate(p.date) : '') + '</div>' +
      '</div></a>';
  }

  /* ───────────────────────── widget mode ───────────────────────── */
  function mountWidget(root, host) {
    var count = Math.max(1, Math.min(8, +root.getAttribute('data-count') || 4));
    var blogUrl = root.getAttribute('data-blog-url') || '/blog';
    getJSON(api(host, '?limit=' + count)).then(function (d) {
      var posts = d.posts || [];
      if (!posts.length) return;
      root.className = 'gv' + themeClass(root);
      applyBranding(root, d.branding);
      applyDesign(root, window, document);
      root.innerHTML =
        '<div class="gv-head"><div>' +
          '<div class="gv-kicker">From the blog</div>' +
          '<div class="gv-h" style="font-size:20px">Latest articles</div>' +
        '</div><a class="gv-link" href="' + esc(blogUrl) + '">Read the blog →</a></div>' +
        '<div class="gv-grid">' +
          posts.map(function (p) { return cardHTML(p, blogUrl.replace(/\/$/, '') + '/' + p.slug); }).join('') +
        '</div>';
    }).catch(function () {});
  }

  /* ───────────────────────── full blog mode ───────────────────────── */

  /* Lay out the default list view: which post goes in the featured card, which
     fill the grid, and — the part that used to be wrong — whether an empty grid
     means "nothing matched" or "everything is already featured".

     The featured post is pulled OUT of the grid pool, so a blog with exactly one
     published post leaves the pool empty. That is not a failed search: it is
     every blog's FIRST publish, and printing "No articles match" under a
     perfectly good featured card makes a working blog look broken to the reader
     at the one moment it is most likely to be looked at. Only a real search or
     genre filter can produce a genuine no-match.

     Top-level and pure so it's unit-testable — embed.js runs on domains we don't
     control and has no DOM harness. */
  function planList(posts, isDefault, page, per) {
    var feat = isDefault ? posts[0] || null : null;
    var pool = feat ? posts.filter(function (p) { return p.slug !== feat.slug; }) : posts.slice();
    var pages = Math.max(1, Math.ceil(pool.length / per));
    var pg = Math.min(Math.max(1, page), pages);
    return {
      feat: feat,
      pages: pages,
      page: pg,
      items: pool.slice((pg - 1) * per, pg * per),
      noMatch: pool.length === 0 && !isDefault,
    };
  }

  function mountBlog(root, host) {
    root.className = 'gv' + themeClass(root);
    applyDesign(root, window, document); // theme the loading state too, not just the result
    root.innerHTML = '<div class="gv-empty">Loading…</div>';
    var HASH = '#grove/';
    // Hybrid mode: when data-article-base is set, cards link to the customer's
    // own server-rendered article pages ({base}/{slug}) instead of the in-page
    // hash reader — keeps articles crawlable/SEO'd on their domain.
    var artBase = root.getAttribute('data-article-base');
    function articleHref(slug) {
      return artBase ? artBase.replace(/\/$/, '') + '/' + slug : HASH + slug;
    }

    loadAll(host).then(function (r) {
      var posts = r.posts;
      applyBranding(root, r.branding);
      applyDesign(root, window, document); // re-run: --gv-on-accent depends on the branding accent
      if (!posts.length) { root.innerHTML = '<div class="gv-empty">New articles are on the way — check back soon.</div>'; return; }
      var genres = ['All'];
      posts.forEach(function (p) { var g = p.genre || 'Article'; if (genres.indexOf(g) < 0) genres.push(g); });
      var state = { genre: 'All', q: '', page: 1 };

      function route() {
        var h = location.hash || '';
        if (h.indexOf(HASH) === 0) renderArticle(h.slice(HASH.length));
        else renderList();
      }

      function renderArticle(slug) {
        root.innerHTML = '<div class="gv-empty">Loading…</div>';
        getJSON(api(host, '/article/' + encodeURIComponent(slug))).then(function (d) {
          var a = d.article; if (!a) { location.hash = ''; return; }
          var cover = a.cover_image_url ? '<img class="gv-art-cover" src="' + esc(a.cover_image_url) + '" alt="">' : '';
          root.innerHTML =
            '<span class="gv-back">← All articles</span>' +
            '<div><span class="gv-badge">' + esc(a.genre || 'Article') + '</span></div>' +
            '<h1 class="gv-art-title">' + esc(a.title) + '</h1>' +
            '<div class="gv-art-meta">' + (a.author ? 'By ' + esc(a.author) + ' · ' : '') + fmtDate(a.published_at) + '</div>' +
            cover + '<div class="grove-article">' + (a.html || '') + '</div>';
          root.querySelector('.gv-back').addEventListener('click', function () { location.hash = ''; });
          track(a.post_id, a.domain_id, root);
          window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' });
        }).catch(function () { location.hash = ''; });
      }

      function filtered() {
        var q = state.q.trim().toLowerCase();
        return posts.filter(function (p) {
          var mg = state.genre === 'All' || (p.genre || 'Article') === state.genre;
          var ms = !q || (p.title || '').toLowerCase().indexOf(q) >= 0 || (p.excerpt || '').toLowerCase().indexOf(q) >= 0;
          return mg && ms;
        });
      }

      function renderList() {
        if (_trackTeardown) { _trackTeardown(); _trackTeardown = null; } // stop the article tracker
        var isDefault = state.genre === 'All' && !state.q.trim();
        var PER = 9;
        var plan = planList(filtered(), isDefault, state.page, PER);
        state.page = plan.page;
        var feat = plan.feat;
        var pages = plan.pages;
        var items = plan.items;
        var href = articleHref;

        var featHTML = (feat && state.page === 1) ? (
          '<a class="gv-feat" href="' + esc(href(feat.slug)) + '">' +
            (feat.cover_image_url
              ? '<div class="gv-feat-media" style="background-image:url(' + esc(feat.cover_image_url) + ')"></div>'
              : '<div class="gv-feat-media" style="--gv-ph:' + bgFor(feat.slug) + '">' + esc(initial(feat.title)) + '</div>') +
            '<div class="gv-feat-body">' +
              '<div><span class="gv-badge" style="background:var(--gv-accent);color:var(--gv-on-accent)">★ Featured</span> ' +
              '<span class="gv-badge">' + esc(feat.genre || 'Article') + '</span></div>' +
              '<div class="gv-feat-title">' + esc(feat.title) + '</div>' +
              (feat.excerpt ? '<div class="gv-ex" style="font-size:15px;-webkit-line-clamp:3">' + esc(feat.excerpt) + '</div>' : '') +
              '<div class="gv-byline">' + (feat.author ? 'By ' + esc(feat.author) + ' · ' : '') + fmtDate(feat.date) + '</div>' +
            '</div></a>'
        ) : '';

        var gridHTML = items.length
          ? '<div class="gv-grid">' + items.map(function (p) { return cardHTML(p, href(p.slug)); }).join('') + '</div>'
          : plan.noMatch
            ? '<div class="gv-empty">No articles match' + (state.q ? ' “' + esc(state.q) + '”' : '') + '. <span class="gv-link" data-clear style="cursor:pointer">Clear</span></div>'
            : '';

        var pagerHTML = pages > 1
          ? '<div class="gv-pager"><button class="gv-pg" data-prev' + (state.page <= 1 ? ' disabled' : '') + '>← Newer</button>' +
            '<span style="font-family:var(--gv-label-font,inherit);font-size:12px;color:var(--gv-muted)">Page ' + state.page + ' / ' + pages + '</span>' +
            '<button class="gv-pg" data-next' + (state.page >= pages ? ' disabled' : '') + '>Older →</button></div>'
          : '';

        root.innerHTML =
          '<div class="gv-head"><div>' +
            '<div class="gv-kicker">The blog</div>' +
            '<div class="gv-h" style="font-size:24px;font-weight:700">Latest articles</div>' +
          '</div><input class="gv-search" type="search" placeholder="Search articles…" value="' + esc(state.q) + '"></div>' +
          '<div class="gv-chips">' + genres.map(function (g) {
            return '<button class="gv-chip' + (state.genre === g ? ' on' : '') + '" data-genre="' + esc(g) + '">' + esc(g) + '</button>';
          }).join('') + '</div>' +
          featHTML + gridHTML + pagerHTML;

        var search = root.querySelector('.gv-search');
        search.addEventListener('input', function (e) { state.q = e.target.value; state.page = 1; var pos = e.target.selectionStart; renderList(); var ns = root.querySelector('.gv-search'); ns.focus(); try { ns.setSelectionRange(pos, pos); } catch (x) {} });
        root.querySelectorAll('[data-genre]').forEach(function (b) {
          b.addEventListener('click', function () { state.genre = b.getAttribute('data-genre'); state.page = 1; renderList(); });
        });
        var prev = root.querySelector('[data-prev]'); if (prev) prev.addEventListener('click', function () { if (state.page > 1) { state.page--; renderList(); window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); } });
        var next = root.querySelector('[data-next]'); if (next) next.addEventListener('click', function () { if (state.page < pages) { state.page++; renderList(); window.scrollTo({ top: root.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); } });
        var clr = root.querySelector('[data-clear]'); if (clr) clr.addEventListener('click', function () { state.q = ''; state.genre = 'All'; state.page = 1; renderList(); });
      }

      window.addEventListener('hashchange', route);
      route();
    }).catch(function () {
      root.innerHTML = '<div class="gv-empty">Couldn\'t load the blog. Please try again later.</div>';
    });
  }

  // page through the host feed (cap 240) so search/filter/pagination is client-side
  function loadAll(host) {
    var all = [], branding = null;
    function page(n) {
      return getJSON(api(host, '?limit=24&page=' + n)).then(function (d) {
        all = all.concat(d.posts || []);
        if (!branding) branding = d.branding || null;
        if (n < (d.pages || 1) && n < 10) return page(n + 1);
        return { posts: all, branding: branding };
      });
    }
    return page(1);
  }

  /* ───────────────────────── legacy simple list ───────────────────────── */
  function mountFeed(root, host) {
    getJSON(api(host, '?limit=12')).then(function (d) {
      root.className = 'gv' + themeClass(root);
      applyBranding(root, d.branding);
      applyDesign(root, window, document);
      root.innerHTML =
        '<div class="gv-kicker">From the ' + esc(d.domain || '') + ' blog</div>' +
        '<div class="gv-grid">' + (d.posts || []).map(function (p) {
          return cardHTML(p, p.url || '#');
        }).join('') + '</div>';
    }).catch(function () {});
  }

  /* Which domain's blog this mount shows. Auto-detection is right on the
     customer's own site, but wrong everywhere the site is served from a host
     that doesn't own the blog — preview deploys, staging, localhost — where the
     lookup 404s and the section renders empty. data-host pins it. */
  function hostFor(root) {
    var pinned = (root.getAttribute('data-host') || '').trim()
      .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return pinned || window.location.hostname;
  }

  function mount() {
    var targets = [
      ['[id^="grove-widget"],[data-grove-widget]', mountWidget],
      ['[id^="grove-blog"],[data-grove-blog]', mountBlog],
      ['[id^="grove-feed"],[data-grove-feed]', mountFeed]
    ];
    var any = false, accent = '#4e9e6a';
    targets.forEach(function (t) {
      document.querySelectorAll(t[0]).forEach(function (el) {
        any = true;
        var a = el.getAttribute('data-accent'); if (a) accent = a;
      });
    });
    if (!any) return;
    injectStyle(accent);
    injectArticleCss();
    targets.forEach(function (t) {
      document.querySelectorAll(t[0]).forEach(function (el) {
        var host = hostFor(el);
        if (!host || host === 'localhost') return; // nothing to look up
        t[1](el, host);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
