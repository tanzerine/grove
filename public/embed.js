/* grove embed.js — zero-config edition.
   Just paste this anywhere on your site:

     <div id="grove-feed"></div>
     <script src="https://grove-red.vercel.app/embed.js" async></script>

   No slug, no API key. We auto-detect your domain from window.location.
*/
(function () {
  function card(p) {
    var a = document.createElement('a');
    a.className = 'grv-card';
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener';
    var h = document.createElement('div');
    h.className = 'grv-title';
    h.textContent = p.title;
    var ex = document.createElement('p');
    ex.className = 'grv-ex';
    ex.textContent = p.excerpt || '';
    var dt = document.createElement('span');
    dt.className = 'grv-date';
    dt.textContent = [p.genre, p.author ? 'By ' + p.author : '', (p.date || '').slice(0, 10)]
      .filter(Boolean).join(' · ');
    a.appendChild(h); a.appendChild(ex); a.appendChild(dt);
    return a;
  }

  function render(root, data, origin, hostname) {
    var s = document.createElement('style');
    s.textContent =
      '.grv-card{display:block;padding:14px 0;border-bottom:1px solid #e6e2d6;text-decoration:none;color:inherit}' +
      '.grv-title{font-weight:600;font-size:17px;line-height:1.35;margin:0 0 4px}' +
      '.grv-ex{color:#7a8a7d;font-size:14px;margin:0}' +
      '.grv-date{font-family:ui-monospace,monospace;font-size:11px;color:#7a8a7d;margin-top:4px;display:block}' +
      '.grv-head{font-family:ui-sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4e9e6a;margin:0 0 10px}' +
      '.grv-more{display:block;width:100%;margin-top:12px;padding:10px;border:1px solid #e6e2d6;border-radius:8px;background:none;font:inherit;font-size:13px;color:#4e9e6a;cursor:pointer}';
    root.appendChild(s);

    var head = document.createElement('div');
    head.className = 'grv-head';
    head.textContent = 'From the ' + data.domain + ' blog';
    root.appendChild(head);

    var list = document.createElement('div');
    root.appendChild(list);
    data.posts.forEach(function (p) { list.appendChild(card(p)); });

    if ((data.pages || 1) > (data.page || 1)) {
      var page = data.page || 1;
      var btn = document.createElement('button');
      btn.className = 'grv-more';
      btn.type = 'button';
      btn.textContent = 'More articles ↓';
      btn.onclick = function () {
        btn.disabled = true;
        fetch(origin + '/api/embed/host/' + encodeURIComponent(hostname) + '?page=' + (page + 1))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            page = d.page;
            (d.posts || []).forEach(function (p) { list.appendChild(card(p)); });
            if (page >= d.pages) btn.remove();
            else btn.disabled = false;
          })
          .catch(function () { btn.remove(); });
      };
      root.appendChild(btn);
    }
  }

  function mount() {
    var roots = document.querySelectorAll('[id^="grove-feed"]');
    if (!roots.length) return;
    var origin =
      (document.currentScript && document.currentScript.src && new URL(document.currentScript.src).origin) ||
      'https://grove-red.vercel.app';
    var hostname = window.location.hostname;
    if (!hostname || hostname === 'localhost') return; // nothing to embed locally

    fetch(origin + '/api/embed/host/' + encodeURIComponent(hostname))
      .then(function (r) {
        if (!r.ok) throw new Error('grove embed: ' + r.status);
        return r.json();
      })
      .then(function (d) {
        roots.forEach(function (root) { render(root, d, origin, hostname); });
      })
      .catch(function () { /* fail silent — embed just renders nothing */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
