#!/usr/bin/env python3
"""Ten fake customer sites, one skeleton, ten design systems.

The skeleton is identical on every page so that anything that differs in the
embed is the embed reacting to the page, not to the markup. Each site declares
only what embed.js actually measures: painted background, ink, body font,
heading font, and the corner radius of its own buttons and cards.
"""
import pathlib, sys

SITES = [
    # id, label, bg, ink, muted, body font, heading font, radius, brand accent
    ("paper-serif",   "Thornfield & Co",  "#faf7f0", "#2e2419", "#7a6a55",
     "'Iowan Old Style', Georgia, serif", "Georgia, serif", 2,  "#8c5a2b"),
    ("midnight-neon", "Vector",           "#0a0b10", "#e8ecf5", "#8891a8",
     "Inter, system-ui, sans-serif", "Inter, system-ui, sans-serif", 16, "#22d3ee"),
    ("brutalist",     "SLAB",             "#ffffff", "#000000", "#444444",
     "'Courier New', monospace", "'Arial Black', sans-serif", 0,  "#ff2d00"),
    ("corporate",     "Northbridge",      "#f5f8ff", "#10203a", "#5a6b85",
     "'Segoe UI', system-ui, sans-serif", "'Segoe UI', system-ui, sans-serif", 8, "#1d4ed8"),
    ("pastel",        "bloom.",           "#fdf2f8", "#4a2545", "#8d6f88",
     "'Avenir Next', system-ui, sans-serif", "'Avenir Next', system-ui, sans-serif", 24, "#ec4899"),
    ("terminal",      "root@nine",        "#011627", "#d6deeb", "#7c8fa8",
     "'SF Mono', ui-monospace, monospace", "'SF Mono', ui-monospace, monospace", 0, "#22c55e"),
    ("sand",          "Marram",           "#e8e2d5", "#2a2620", "#6f665a",
     "'Helvetica Neue', system-ui, sans-serif", "'Playfair Display', Georgia, serif", 4, "#7c6a46"),
    ("hicontrast",    "OBSIDIAN",         "#000000", "#ffffff", "#9a9a9a",
     "Helvetica, system-ui, sans-serif", "Helvetica, system-ui, sans-serif", 12, "#e879f9"),
    ("mint",          "Sprig",            "#ffffff", "#0f2b23", "#5c7a70",
     "system-ui, sans-serif", "system-ui, sans-serif", 20, "#10b981"),
    # Mid-grey sits just on the DARK side of the 0.22 luminance threshold —
    # the boundary where a "light or dark?" decision can go visibly wrong.
    ("midgrey",       "Halden",           "#6f7278", "#f2f2f0", "#c9cacd",
     "Inter, system-ui, sans-serif", "Inter, system-ui, sans-serif", 6,  "#1e293b"),
]

TPL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{label} — embed host test ({id})</title>
<style>
  :root {{ --bg:{bg}; --ink:{ink}; --muted:{muted}; --accent:{accent}; --r:{r}px; }}
  * {{ box-sizing: border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink); font-family:{body}; line-height:1.6; }}
  header {{ display:flex; align-items:center; gap:24px; padding:18px 28px;
            border-bottom:1px solid color-mix(in srgb, var(--ink) 14%, transparent); }}
  header .brand {{ font-family:{head}; font-weight:700; font-size:18px; }}
  header nav {{ display:flex; gap:18px; margin-left:auto; font-size:14px; color:var(--muted); }}
  main {{ max-width:1080px; margin:0 auto; padding:56px 28px 96px; }}
  h1 {{ font-family:{head}; font-size:44px; line-height:1.1; margin:0 0 16px; }}
  h2 {{ font-family:{head}; font-size:26px; margin:0 0 12px; }}
  p.lead {{ font-size:19px; color:var(--muted); max-width:60ch; margin:0 0 28px; }}
  .btn {{ display:inline-block; padding:10px 20px; border-radius:var(--r);
          background:var(--accent); color:var(--bg); text-decoration:none; font-weight:600; }}
  .btn.ghost {{ background:transparent; color:var(--ink);
                border:1px solid color-mix(in srgb, var(--ink) 30%, transparent); }}
  .cards {{ display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin:36px 0 64px; }}
  .card {{ border:1px solid color-mix(in srgb, var(--ink) 14%, transparent);
           border-radius:var(--r); padding:20px;
           background:color-mix(in srgb, var(--ink) 4%, transparent); }}
  .card h3 {{ font-family:{head}; margin:0 0 6px; font-size:16px; }}
  .card p {{ margin:0; font-size:14px; color:var(--muted); }}
  .sec-label {{ font-size:12px; letter-spacing:.14em; text-transform:uppercase;
                color:var(--accent); margin-bottom:10px; }}
  footer {{ padding:32px 28px; color:var(--muted); font-size:13px;
            border-top:1px solid color-mix(in srgb, var(--ink) 14%, transparent); }}
</style></head>
<body>
<header>
  <span class="brand">{label}</span>
  <nav><span>Product</span><span>Docs</span><span>Pricing</span><span>Blog</span></nav>
</header>
<main>
  <h1>{headline}</h1>
  <p class="lead">A wireframe standing in for a real customer site. Everything below the
     divider is grove's embed, mounted with two lines and no styling of its own.</p>
  <p><a class="btn" href="#">Get started</a> <a class="btn ghost" href="#">Read the docs</a></p>

  <div class="cards">
    <div class="card"><h3>One</h3><p>Filler card so the embed has a radius to sample.</p></div>
    <div class="card"><h3>Two</h3><p>Filler card so the embed has a radius to sample.</p></div>
    <div class="card"><h3>Three</h3><p>Filler card so the embed has a radius to sample.</p></div>
  </div>

  <div class="sec-label">From the blog</div>
  <h2>Written by grove</h2>
  <!-- THE EMBED — exactly what a customer pastes -->
  <div id="grove-blog" data-host="trygroveai.com"
       data-article-base="https://trygroveai.com/b/trygroveai-com-o6hf"></div>
</main>
<footer>&copy; 2026 {label} — embed host fixture <code>{id}</code></footer>
<script src="{embed}" async></script>
</body></html>
"""

HEADLINES = {
    "paper-serif": "Furniture that outlives the fashion.",
    "midnight-neon": "Ship faster. Break nothing.",
    "brutalist": "WE MAKE CONCRETE THINGS",
    "corporate": "Enterprise risk, quantified.",
    "pastel": "Skincare that actually listens.",
    "terminal": "Observability for people who read logs.",
    "sand": "Slow textiles, made on the coast.",
    "hicontrast": "Sound engineering, no compromise.",
    "mint": "Grow plants you cannot kill.",
    "midgrey": "Industrial coatings since 1961.",
}

# `python3 build.py --local` points the pages at embed.local.js instead, so a
# working-copy embed.js can be tested against the live API (see README).
EMBED = 'embed.local.js' if '--local' in sys.argv else 'https://trygroveai.com/embed.js'

out = pathlib.Path(__file__).parent
index = ["<!doctype html><meta charset=utf-8><title>embed host fixtures</title>",
         "<style>body{font:15px/1.7 system-ui;margin:40px;max-width:640px}a{display:block;padding:6px 0}</style>",
         "<h1>Embed host fixtures</h1><p>Ten fake customer sites, one embed.</p>"]
for sid, label, bg, ink, muted, body, head, r, accent in SITES:
    html = TPL.format(id=sid, label=label, bg=bg, ink=ink, muted=muted, body=body,
                      head=head, r=r, accent=accent, headline=HEADLINES[sid], embed=EMBED)
    (out / f"{sid}.html").write_text(html)
    index.append(f'<a href="{sid}.html">{sid} — {label} <small>({bg} / {ink}, r{r})</small></a>')
(out / "index.html").write_text("\n".join(index))
print(f"wrote {len(SITES)} fixtures + index")
