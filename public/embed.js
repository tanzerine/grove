/* grove embed.js — paste once on your site:
     <div id="grove-feed" data-slug="YOUR_BLOG_SLUG"></div>
     <script src="https://app.grove.so/embed.js" async></script>
*/
(function () {
  function render(root, data) {
    var s = document.createElement('style');
    s.textContent = '.grv-card{display:block;padding:14px 0;border-bottom:1px solid #e6e2d6;text-decoration:none;color:inherit}' +
      '.grv-title{font-weight:600;font-size:17px;line-height:1.35;margin:0 0 4px}' +
      '.grv-ex{color:#7a8a7d;font-size:14px;margin:0}' +
      '.grv-date{font-family:ui-monospace,monospace;font-size:11px;color:#7a8a7d;margin-top:4px;display:block}' +
      '.grv-head{font-family:ui-sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#4e9e6a;margin:0 0 10px}';
    root.appendChild(s);
    var head = document.createElement('div'); head.className = 'grv-head'; head.textContent = 'From the ' + data.domain + ' blog';
    root.appendChild(head);
    data.posts.forEach(function (p) {
      var a = document.createElement('a');
      a.className = 'grv-card'; a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
      var h = document.createElement('div'); h.className = 'grv-title'; h.textContent = p.title;
      var ex = document.createElement('p'); ex.className = 'grv-ex'; ex.textContent = p.excerpt || '';
      var dt = document.createElement('span'); dt.className = 'grv-date'; dt.textContent = (p.date || '').slice(0, 10);
      a.appendChild(h); a.appendChild(ex); a.appendChild(dt);
      root.appendChild(a);
    });
  }
  var roots = document.querySelectorAll('[id^="grove-feed"]');
  roots.forEach(function (root) {
    var slug = root.getAttribute('data-slug');
    if (!slug) return;
    var origin = (document.currentScript && document.currentScript.src && new URL(document.currentScript.src).origin) || 'https://app.grove.so';
    fetch(origin + '/api/embed/' + slug)
      .then(function (r) { return r.json(); })
      .then(function (d) { render(root, d); })
      .catch(function () { root.textContent = ''; });
  });
})();
