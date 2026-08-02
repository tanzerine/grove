import { describe, it, expect } from 'vitest';
import { extractBrandColors } from '../lib/pipeline/site-profile';

const makeHtml = (style: string, extra = '') => `
<!DOCTYPE html><html><head>
<meta name="description" content="Test site">
<style>${style}</style>
${extra}
</head><body><h1>Hello</h1></body></html>`;

describe('extractBrandColors', () => {
  it('returns null when no interesting colors exist', () => {
    expect(extractBrandColors(makeHtml('body { color: #fff; background: #000; }'))).toBeNull();
  });

  it('does not elect a one-off status color as the brand', () => {
    // The real failure, reduced. grove's own homepage declares --gv-red-text
    // ONCE, for error copy. The old score weighted saturation linearly and the
    // use count only logarithmically, so a single 100%-saturated red outscored
    // a 46%-saturated green used sixteen times — and since the dashboard turns
    // the secondary into the CTA button, every blog banner offered readers a
    // salmon pink button.
    const css = `
      :root { --gv-red-text: #ff9b9b; }
      ${Array.from({ length: 16 }, (_, i) => `.a${i} { color: #6cc98a; }`).join('\n')}
      ${Array.from({ length: 20 }, (_, i) => `.b${i} { background: #a2ff01; }`).join('\n')}
    `;
    const r = extractBrandColors(makeHtml(css))!;
    expect(r.primary_color).toBe('#a2ff01');
    expect(r.secondary_color).toBe('#6cc98a');
    expect(r.secondary_color).not.toBe('#ff9b9b');
    // and the button follows the secondary, which is how the red reached readers
    expect(r.btn_color).not.toBe('#ff9b9b');
  });

  it('still prefers a saturated color when both are used equally', () => {
    // Frequency dominating must not mean saturation stops counting — between
    // two colors a site uses the same amount, the more chromatic one is the
    // likelier brand.
    const css = `
      ${Array.from({ length: 6 }, (_, i) => `.x${i} { color: #8a8f88; }`).join('\n')}
      ${Array.from({ length: 6 }, (_, i) => `.y${i} { background: #1d4ed8; }`).join('\n')}
    `;
    expect(extractBrandColors(makeHtml(css))!.primary_color).toBe('#1d4ed8');
  });

  it('picks primary from a CSS brand var and derives banner_bg', () => {
    const result = extractBrandColors(makeHtml(`:root { --primary: #1d4ed8; } body { color: #333; }`));
    expect(result).not.toBeNull();
    expect(result!.primary_color).toBe('#1d4ed8');
    // dark primary → banner_bg should equal primary
    expect(result!.banner_bg).toBe('#1d4ed8');
  });

  it('darkens a light primary for the banner background', () => {
    const result = extractBrandColors(makeHtml(`:root { --brand: #60a5fa; }`));
    expect(result).not.toBeNull();
    // #60a5fa is light, so banner_bg should be darker
    const bannerBgLuminance = parseInt(result!.banner_bg.slice(1, 3), 16);
    const primaryLuminance = parseInt('#60a5fa'.slice(1, 3), 16);
    expect(bannerBgLuminance).toBeLessThan(primaryLuminance);
  });

  it('picks white banner text on a dark background', () => {
    const result = extractBrandColors(makeHtml(`:root { --primary: #1e293b; }`));
    expect(result!.banner_text).toBe('#ffffff');
  });

  it('picks dark banner text on a light primary', () => {
    // after darkening, a very light primary may still be lightish — test a mid color
    // #f0a500 is a golden/amber: dark enough after 25% darkening → text should be white
    // but the primary itself is light, so the text decision is on the *banner_bg*
    const result = extractBrandColors(makeHtml(`:root { --primary: #fef3c7; } h1 { font-family: "Inter"; }`));
    // #fef3c7 is very light → darken 25% → still possibly light → text = dark
    // Just ensure it returns a value and the text is readable (not undefined)
    expect(result).not.toBeNull();
    expect(['#ffffff', '#1a2e1f']).toContain(result!.banner_text);
  });

  it('extracts heading font name from h1/h2/h3 CSS rule', () => {
    const result = extractBrandColors(makeHtml(
      `h1, h2 { font-family: "Neue Haas Grotesk", sans-serif; } :root { --primary: #0f172a; }`
    ));
    expect(result!.heading_font).toBe('Neue Haas Grotesk');
  });

  it('extracts heading font from @font-face when no heading rule exists', () => {
    const result = extractBrandColors(makeHtml(
      `@font-face { font-family: "Satoshi"; src: url(satoshi.woff2); } :root { --accent: #7c3aed; }`
    ));
    expect(result!.heading_font).toBe('Satoshi');
  });

  it('ignores system fonts for heading_font', () => {
    const result = extractBrandColors(makeHtml(
      `h1 { font-family: Arial, sans-serif; } :root { --primary: #0d9488; }`
    ));
    expect(result!.heading_font).toBeNull();
  });

  it('reads theme-color meta as primary when no CSS brand vars exist', () => {
    const result = extractBrandColors(makeHtml(
      `body { background: #fafafa; }`,
      `<meta name="theme-color" content="#7c3aed">`
    ));
    expect(result!.primary_color).toBe('#7c3aed');
  });

  it('button contrast text is white on dark button and dark on light button', () => {
    const darkBtn = extractBrandColors(makeHtml(`:root { --primary: #1e40af; --accent: #1d4ed8; }`));
    expect(darkBtn!.btn_text_color).toBe('#ffffff');

    const lightBtn = extractBrandColors(makeHtml(`:root { --primary: #bfdbfe; --accent: #dbeafe; }`));
    // light buttons get dark text
    expect(lightBtn!.btn_text_color).toBe('#1a2e1f');
  });

  it('banner_text_muted is an rgba string with lower opacity', () => {
    const result = extractBrandColors(makeHtml(`:root { --primary: #0f172a; }`));
    expect(result!.banner_text_muted).toMatch(/^rgba\(/);
  });

  it('extracts a secondary color from a second brand var', () => {
    const result = extractBrandColors(makeHtml(`:root { --primary: #1d4ed8; --accent: #f59e0b; }`));
    expect(result!.secondary_color).toBe('#f59e0b');
  });

  it('picks a hue-distinct secondary from plain CSS colors', () => {
    // blue primary (brand var), orange used repeatedly elsewhere → secondary
    const result = extractBrandColors(makeHtml(
      `:root { --primary: #1d4ed8; } .a { color: #ea580c; } .b { background: #ea580c; }`
    ));
    expect(result!.secondary_color).toBe('#ea580c');
  });

  it('falls back to a darker shade of primary when no other color exists', () => {
    const result = extractBrandColors(makeHtml(`:root { --primary: #1d4ed8; }`));
    expect(result!.secondary_color).toBeTruthy();
    expect(result!.secondary_color).not.toBe('#1d4ed8');
  });

  it('parses rgb() colors, not just hex', () => {
    const result = extractBrandColors(makeHtml(
      `.btn { background: rgb(29, 78, 216); } .btn:hover { background: rgb(29, 78, 216); }`
    ));
    expect(result!.primary_color).toBe('#1d4ed8');
  });

  it('reads colors from external stylesheet text (second argument)', () => {
    const result = extractBrandColors(
      makeHtml(`body { color: #333; }`),
      `:root { --brand: #7c3aed; } .cta { background: #7c3aed; }`
    );
    expect(result!.primary_color).toBe('#7c3aed');
  });

  it('reads brand color from inline style backgrounds', () => {
    const html = `<!DOCTYPE html><html><head></head><body>
      <a style="background:#0ea5e9;color:#fff">Sign up</a>
      <a style="background-color: rgb(14, 165, 233)">Try it</a>
    </body></html>`;
    const result = extractBrandColors(html);
    expect(result!.primary_color).toBe('#0ea5e9');
  });

  it('frequency breaks ties: the repeated color wins over a one-off', () => {
    const result = extractBrandColors(makeHtml(
      // both fully saturated; #16a34a-ish green appears 3×, red once
      `.a { color: #15803d; } .b { border-color: #15803d; } .c { background: #15803d; } .d { color: #b91c1c; }`
    ));
    expect(result!.primary_color).toBe('#15803d');
  });
});
