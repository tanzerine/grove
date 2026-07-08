/* grove embed.js — zero-config blog for your own site.
   Auto-detects your domain; no slug, no API key.

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
                     your homepage (returned by the API), else #4e9e6a.
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

  var STYLE_ID = 'grove-embed-style';
  function injectStyle(accent) {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.gv{--gv-accent:' + accent + ';--gv-line:#e6e2d6;--gv-ink:#1a2e1f;--gv-muted:#7a8a7d;color:var(--gv-ink);}',
      '.gv *{box-sizing:border-box}',
      '.gv a{text-decoration:none;color:inherit}',
      '.gv-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:22px}',
      '.gv-h{font-size:13px;font-weight:600}',
      '.gv-kicker{font-family:ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--gv-accent);margin-bottom:6px}',
      '.gv-link{font-family:ui-monospace,monospace;font-size:12px;color:var(--gv-accent)}',
      '.gv-search{width:230px;max-width:60vw;padding:9px 14px;border:1px solid var(--gv-line);border-radius:999px;font:inherit;font-size:14px;outline:none}',
      '.gv-search:focus{border-color:var(--gv-accent);box-shadow:0 0 0 3px rgba(78,158,106,.15);box-shadow:0 0 0 3px color-mix(in srgb,var(--gv-accent) 15%,transparent)}',
      '.gv-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 22px}',
      '.gv-chip{font-family:ui-monospace,monospace;font-size:12px;padding:6px 14px;border-radius:999px;border:1px solid var(--gv-line);background:#fff;cursor:pointer;color:var(--gv-ink)}',
      '.gv-chip:hover{border-color:var(--gv-accent);color:var(--gv-accent)}',
      '.gv-chip.on{background:var(--gv-accent);color:#fff;border-color:var(--gv-accent)}',
      '.gv-badge{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--gv-accent);background:rgba(78,158,106,.10);background:color-mix(in srgb,var(--gv-accent) 10%,transparent);border-radius:999px;padding:3px 9px}',
      '.gv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}',
      '.gv-card{display:flex;flex-direction:column;background:#fff;border:1px solid var(--gv-line);border-radius:14px;overflow:hidden;transition:transform .16s,box-shadow .16s,border-color .16s}',
      '.gv-card:hover{transform:translateY(-3px);border-color:var(--gv-accent);box-shadow:0 16px 34px -20px rgba(26,46,31,.28)}',
      '.gv-cover{height:160px;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:700;color:rgba(26,46,31,.28)}',
      '.gv-cardbody{padding:16px 18px 18px;display:flex;flex-direction:column;flex:1}',
      '.gv-title{font-size:18px;font-weight:600;line-height:1.25;margin:10px 0 0}',
      '.gv-ex{font-size:13.5px;color:var(--gv-muted);line-height:1.55;margin:8px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.gv-byline{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--gv-muted);margin-top:14px}',
      '.gv-feat{display:grid;grid-template-columns:1.05fr 1fr;background:#fff;border:1px solid var(--gv-line);border-radius:18px;overflow:hidden;margin-bottom:26px;transition:transform .16s,box-shadow .16s,border-color .16s}',
      '.gv-feat:hover{transform:translateY(-3px);border-color:var(--gv-accent);box-shadow:0 20px 48px -24px rgba(26,46,31,.32)}',
      '.gv-feat-media{min-height:320px;background-size:cover;background-position:center;display:flex;align-items:center;justify-content:center;font-size:88px;font-weight:700;color:rgba(26,46,31,.26)}',
      '.gv-feat-body{padding:34px 36px;display:flex;flex-direction:column;justify-content:center}',
      '.gv-feat-title{font-size:30px;font-weight:700;line-height:1.12;margin:14px 0 0}',
      '.gv-pager{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:40px}',
      '.gv-pg{font-family:ui-monospace,monospace;font-size:13px;color:var(--gv-accent);background:#fff;border:1px solid var(--gv-line);border-radius:999px;padding:8px 16px;cursor:pointer}',
      '.gv-pg[disabled]{color:#c2c2bb;cursor:default}',
      '.gv-empty{padding:60px 0;text-align:center;color:var(--gv-muted);font-size:14px}',
      '.gv-back{font-family:ui-monospace,monospace;font-size:12px;color:var(--gv-accent);display:inline-block;margin-bottom:18px;cursor:pointer}',
      '.gv-art-title{font-size:clamp(28px,4.2vw,44px);font-weight:700;line-height:1.15;letter-spacing:-.02em;margin:6px 0 10px}',
      '.gv-art-meta{font-family:ui-monospace,monospace;font-size:12px;color:var(--gv-muted);margin-bottom:22px}',
      '.gv-art-cover{width:100%;border-radius:14px;border:1px solid var(--gv-line);margin-bottom:26px}',
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
    if (branding && branding.accent) root.style.setProperty('--gv-accent', branding.accent);
  }

  function cardHTML(p, href) {
    var cover = p.cover_image_url
      ? '<div class="gv-cover" style="background-image:url(' + esc(p.cover_image_url) + ')"></div>'
      : '<div class="gv-cover" style="background:' + bgFor(p.slug) + '">' + esc(initial(p.title)) + '</div>';
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
      root.className = 'gv';
      applyBranding(root, d.branding);
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
  function mountBlog(root, host) {
    root.className = 'gv';
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
            cover + (a.html || '');
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
        var feat = isDefault ? posts[0] : null;
        var pool = filtered();
        if (feat) pool = pool.filter(function (p) { return p.slug !== feat.slug; });
        var PER = 9;
        var pages = Math.max(1, Math.ceil(pool.length / PER));
        if (state.page > pages) state.page = pages;
        var items = pool.slice((state.page - 1) * PER, state.page * PER);
        var href = articleHref;

        var featHTML = (feat && state.page === 1) ? (
          '<a class="gv-feat" href="' + esc(href(feat.slug)) + '">' +
            (feat.cover_image_url
              ? '<div class="gv-feat-media" style="background-image:url(' + esc(feat.cover_image_url) + ')"></div>'
              : '<div class="gv-feat-media" style="background:' + bgFor(feat.slug) + '">' + esc(initial(feat.title)) + '</div>') +
            '<div class="gv-feat-body">' +
              '<div><span class="gv-badge" style="background:var(--gv-accent);color:#fff">★ Featured</span> ' +
              '<span class="gv-badge">' + esc(feat.genre || 'Article') + '</span></div>' +
              '<div class="gv-feat-title">' + esc(feat.title) + '</div>' +
              (feat.excerpt ? '<div class="gv-ex" style="font-size:15px;-webkit-line-clamp:3">' + esc(feat.excerpt) + '</div>' : '') +
              '<div class="gv-byline">' + (feat.author ? 'By ' + esc(feat.author) + ' · ' : '') + fmtDate(feat.date) + '</div>' +
            '</div></a>'
        ) : '';

        var gridHTML = items.length
          ? '<div class="gv-grid">' + items.map(function (p) { return cardHTML(p, href(p.slug)); }).join('') + '</div>'
          : '<div class="gv-empty">No articles match' + (state.q ? ' “' + esc(state.q) + '”' : '') + '. <span class="gv-link" data-clear style="cursor:pointer">Clear</span></div>';

        var pagerHTML = pages > 1
          ? '<div class="gv-pager"><button class="gv-pg" data-prev' + (state.page <= 1 ? ' disabled' : '') + '>← Newer</button>' +
            '<span style="font-family:ui-monospace,monospace;font-size:12px;color:var(--gv-muted)">Page ' + state.page + ' / ' + pages + '</span>' +
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
      root.className = 'gv';
      applyBranding(root, d.branding);
      root.innerHTML =
        '<div class="gv-kicker">From the ' + esc(d.domain || '') + ' blog</div>' +
        '<div class="gv-grid">' + (d.posts || []).map(function (p) {
          return cardHTML(p, p.url || '#');
        }).join('') + '</div>';
    }).catch(function () {});
  }

  function mount() {
    var host = window.location.hostname;
    if (!host || host === 'localhost') return;

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
    targets.forEach(function (t) {
      document.querySelectorAll(t[0]).forEach(function (el) { t[1](el, host); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
