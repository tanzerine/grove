# Embed host fixtures

Ten fake customer sites with ten different design systems, each mounting
`#grove-blog` exactly the way a customer does. The skeleton is identical on
every page, so anything that differs between them is the embed reacting to the
page rather than to the markup.

`tests/embed-design.test.ts` covers the derivation as pure functions. This
covers the part that suite cannot: what the browser actually computes, on a real
page, with real fonts and a real API response. Every bug listed at the bottom was
invisible to the unit tests and obvious here.

## Running it

```bash
python3 tests/fixtures/embed-hosts/build.py
python3 -m http.server 8801 --directory tests/fixtures/embed-hosts
```

Open <http://localhost:8801/> for the index, or `probe.html`, which loads all ten
in iframes and exposes `window.probe()` — measured page colors, the derived
`--gv-*` values, what the cards actually rendered at, and contrast ratios for
each pair that has to hold up.

By default the pages load the **deployed** `embed.js`, which is what you want for
"is production seamless right now". To test a working copy against the live API:

```bash
python3 - <<'EOF'
import pathlib
src = pathlib.Path('public/embed.js').read_text()
pathlib.Path('tests/fixtures/embed-hosts/embed.local.js').write_text(src.replace(
  "    (document.currentScript && document.currentScript.src && new URL(document.currentScript.src).origin) ||\n    'https://grove-red.vercel.app';",
  "    'https://trygroveai.com'; // TEST BUILD: API pinned"))
EOF
python3 tests/fixtures/embed-hosts/build.py --local
```

`embed.local.js` is gitignored — it is a build artifact, not a fixture.

## Why these ten

Each one is chosen to break a different assumption:

| fixture | what it tests |
|---|---|
| `paper-serif` | serif body + serif headings, warm paper, 2px radius |
| `midnight-neon` | genuinely dark page, large radius |
| `brutalist` | **radius 0**, monospace body, display headings |
| `corporate` | conventional light SaaS — the happy path |
| `pastel` | very light tinted page, 24px radius |
| `terminal` | dark **and** radius 0, monospace throughout |
| `sand` | mid-light page, serif headings over sans body (two faces) |
| `hicontrast` | pure black / pure white |
| `mint` | pure white page, 20px radius |
| `midgrey` | **luminance 0.168** — just inside the `dark` branch, where a page is neither light nor dark |

`midgrey` is the important one. Every formula in `deriveTokens` branches on
`luminance(bg) < 0.22`, and both branches assume the page is *committed* to its
side. A page sitting near the boundary satisfies neither assumption, and that is
where the derivation has failed twice.

## Found here

- **radius 0 was discarded.** `sampleRadius` skipped `r <= 0` as "no system to
  copy", so `brutalist` and `terminal` — sites that square every corner — got
  grove's 14px cards and 999px pills. Now a zero counts, but only from an element
  that is actually a painted surface, so unstyled `<a class>` elements can't vote
  the whole web square.
- **mid-tone cards read worse than the page.** The 7% lift toward white costs
  ~2 points of contrast, which is nothing at 16:1 and fatal at 4.3:1 — `midgrey`
  cards landed at 3.74, below AA and visibly worse than the identical text beside
  them. The lift is now capped by the page's own readability.
- **the brand arrived pre-flattened.** The API sent `accent` already darkened to
  read on white, so grove's lime reached a near-black host as a dark olive and
  stayed one. `accent_raw` carries the uncorrected color for consumers that
  measure. The correction floor also moved 3.2 → 4.5, because the accent is
  mostly 10–12px text here, not a UI component.
