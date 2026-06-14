import { describe, it, expect } from 'vitest';
import { mdToHtml } from '../lib/markdown';

describe('mdToHtml sanitization', () => {
  it('strips <script> tags and their content', () => {
    const html = mdToHtml('Hello\n\n<script>alert(document.cookie)</script>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
  });

  it('removes inline event handlers from raw HTML', () => {
    const html = mdToHtml('<img src=x onerror=alert(1)>');
    expect(html.toLowerCase()).not.toContain('onerror');
    // a raw <a onclick> must lose the handler too
    const a = mdToHtml('<a href="https://ok.test" onclick="steal()">hi</a>');
    expect(a.toLowerCase()).not.toContain('onclick');
  });

  it('drops javascript: hrefs but keeps the link text', () => {
    const html = mdToHtml('[click me](javascript:alert(1))');
    expect(html.toLowerCase()).not.toContain('javascript:');
    expect(html).toContain('click me');
  });

  it('strips raw iframe/object embeds', () => {
    const html = mdToHtml('<iframe src="https://evil.test"></iframe>');
    expect(html.toLowerCase()).not.toContain('<iframe');
  });

  it('preserves safe formatting, links, and heading ids', () => {
    const html = mdToHtml('## Title\n\nSome **bold** and a [link](https://grove.so).');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('href="https://grove.so"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/<h2 id="title"/);
  });

  it('keeps images with safe http(s) sources', () => {
    const html = mdToHtml('![alt text](https://cdn.test/pic.webp)');
    expect(html).toContain('<img');
    expect(html).toContain('src="https://cdn.test/pic.webp"');
    expect(html).toContain('alt="alt text"');
  });
});
